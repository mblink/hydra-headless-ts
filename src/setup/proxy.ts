/**
 * Proxy middleware for OAuth2 authorization flow
 * Uses RedisService from fp/services to store PKCE state with proper error handling
 */
import { randomBytes } from 'crypto';
import { type ClientRequest } from 'http';
import { Effect, Layer } from 'effect';
import express from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { upsertCimdClient } from '../authFlow.js';
import { appConfig } from '../config.js';
import { CimdCacheEntrySchema } from '../fp/domain.js';
import { CimdRedirectUriMismatch } from '../fp/errors.js';
import { cimdContentHash, fetchCimdMetadata, isHttpsUrlClientId } from '../fp/services/cimd.js';
import { RedisService, RedisServiceLive, createOAuthRedisOps } from '../fp/services/redis.js';
import { syncLogger } from '../logging-effect.js';
import { OAuth2ApiLayer } from './hydra.js';
import { redisClient } from './redis.js';
import type { OAuth2ApiService } from '../api/oauth2.js';
import type { CimdMetadata, PKCEState } from '../fp/domain.js';
import type { CimdError, HttpError, SchemaValidationError } from '../fp/errors.js';
import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'net';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create Redis service layer from the redis client
const redisLayer = RedisServiceLive(redisClient);

const proxyOptions = {
  target: appConfig.hydraInternalUrl,
  changeOrigin: true,
  prependPath: false,
  logger: syncLogger,
  on: {
    error: (err: Error, req: Request, res: Response | Socket) => {
      const nodeErr = err as NodeJS.ErrnoException;
      syncLogger.error('Proxy error forwarding request to Hydra', {
        message: err.message,
        code: nodeErr.code,
        method: req.method,
        url: req.url,
        originalUrl: req.originalUrl,
        target: appConfig.hydraInternalUrl,
      });
      if (!('status' in res) || (res as Response).headersSent) return;
      (res as Response).status(502).json({ error: 'proxy_error', message: 'Upstream service unavailable' });
    },
    proxyReq: (proxyReq: ClientRequest, req: Request, _res: Response) => {
      const parsed = new URL(`${req.protocol}://${req.get('host')}${req.originalUrl}`);
      syncLogger.info('Checking for Proxy request to Hydra', {
        method: req.method,
        originalUrl: req.originalUrl,
        proxiedUrl: `${appConfig.hydraInternalUrl}${parsed.pathname}`,
        body: req.body,
      });
      // Hydra expects `contacts` to be an array; some DCR clients send null
      if (req.body?.contacts === null) {
        syncLogger.info('Setting null contacts to [] in /oauth2/register body');
        req.body.contacts = [];
      }
      if (req.method !== 'GET') {
        proxyReq.path = req.originalUrl;
      }
      // The body parsers have already consumed the request stream. fixRequestBody re-sends the
      // parsed body in its original content type (JSON, urlencoded, ...) with a matching
      // Content-Length, including empty bodies.
      fixRequestBody(proxyReq, req);
      syncLogger.info('Proxy onProxyReq processing', {
        method: req.method,
        originalUrl: req.originalUrl,
        proxyPath: proxyReq.path,
      });
    },
  },
  pathRewrite: async (path: string, req: Request) => {
    const parsed = new URL(`${req.protocol}://${req.get('host')}${req.originalUrl}`);
    if (parsed.pathname === '/oauth2/auth') {
      // One id per authorization request, so overlapping flows in the same browser don't share
      // state. It keys the PKCE state in Redis and replaces the client's `state` on the way to
      // Hydra; consent reads it back from Hydra's request_url and sends it to Google as `state`,
      // and the callback looks the flow up by it.
      const flowId = randomBytes(32).toString('base64url');
      // Writing to the session makes express-session persist it and set its cookie, so the
      // callback can check it comes from the browser that started the flow
      req.session.oauthFlowStartedAt = Date.now();

      const { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope } = req.query;

      // Only store PKCE state if we have the required parameters
      if (code_challenge !== undefined && state !== undefined) {
        const method = String(code_challenge_method ?? 'S256');
        const pkceData: PKCEState = {
          code_challenge: String(code_challenge),
          code_challenge_method: method === 'plain' ? 'plain' : 'S256',
          scope: String(scope ?? ''),
          state: String(state),
          redirect_uri: String(redirect_uri ?? ''),
          client_id: String(client_id ?? ''),
          timestamp: Date.now(),
          session_id: req.session.id,
        };

        // Store PKCE state in Redis using Effect with RedisService
        const storePKCE = Effect.gen(function* () {
          const redis = yield* RedisService;
          const redisOps = createOAuthRedisOps(redis);
          return yield* redisOps.setPKCEState(
            flowId,
            pkceData,
            3600, // 1 hour TTL
          );
        });

        // Provide the Redis layer and run the Effect
        const program = Effect.provide(storePKCE, redisLayer);
        const result = await Effect.runPromise(Effect.either(program));

        if (result._tag === 'Left') {
          // Log non-fatal Redis errors but don't fail the request
          syncLogger.error('Failed to store PKCE state in Redis', {
            key: `pkce_session:${flowId}`,
            error: result.left,
            pkceData,
          });
          // Continue processing - Redis failure is not fatal for the proxy
        } else {
          syncLogger.debug('PKCE state stored successfully', {
            key: `pkce_session:${flowId}`,
          });
        }
      }

      // Rewrite the query string
      const queryString = new URLSearchParams(parsed.searchParams.toString());
      queryString.delete('code_challenge');
      queryString.delete('code_challenge_method');
      queryString.set('state', flowId);

      const returnPath = [parsed.pathname, queryString].join('?');
      syncLogger.info('Proxy complete: Sending to Hydra with the flow id as state', { flowId });

      return returnPath;
    }
    syncLogger.info('Proxy pathRewrite: No changes made to path', {
      parsedPath: parsed.pathname,
      body: req.body,
    });
    // Return original path if not /oauth2/auth
    return path;
  },
};

/**
 * Layer providing both RedisService and OAuth2ApiService, for the CIMD
 * pipeline below (fetch/validate a remote document, then shadow-register
 * it into Hydra).
 */
const cimdLayer = Layer.merge(redisLayer, OAuth2ApiLayer);

/**
 * Describe a CIMD pipeline failure for the client-facing 400 response.
 * Intentionally terse — details go to the server log via syncLogger, not
 * to the (untrusted) requester.
 */
const describeCimdError = (error: CimdError | HttpError | SchemaValidationError): string => {
  switch (error._tag) {
    case 'CimdRedirectUriMismatch':
      return 'redirect_uri is not registered for this client';
    case 'CimdInvalidClientId':
    case 'CimdClientIdMismatch':
    case 'CimdSsrfBlocked':
    case 'CimdRedirectRejected':
    case 'CimdFetchTooLarge':
      return 'client_id metadata document could not be fetched or validated';
    default:
      return 'failed to validate client';
  }
};

/**
 * Fetch (or reuse a cached, already-validated) CIMD document for
 * `clientIdUrl`, check the request's redirect_uri against it, and — on a
 * cache miss — shadow-register the client into Hydra's own admin DB so
 * the proxied /oauth2/auth request that follows passes Hydra's native
 * client/redirect_uri validation exactly as it would for a DCR client.
 */
const runCimdPipeline = (
  clientIdUrl: string,
  redirectUri: string,
): Effect.Effect<CimdMetadata, CimdError | HttpError | SchemaValidationError, RedisService | OAuth2ApiService> =>
  Effect.gen(function* () {
    const redis = yield* RedisService;
    const redisOps = createOAuthRedisOps(redis);

    const cached = yield* Effect.either(redisOps.getCimdMetadata(clientIdUrl, CimdCacheEntrySchema));
    if (cached._tag === 'Right') {
      const { metadata } = cached.right;
      if (!metadata.redirect_uris.includes(redirectUri)) {
        return yield* Effect.fail(
          new CimdRedirectUriMismatch({
            clientId: clientIdUrl,
            redirectUri,
            allowed: metadata.redirect_uris,
          }),
        );
      }
      return metadata;
    }

    const metadata = yield* fetchCimdMetadata(clientIdUrl, appConfig.cimd);
    if (!metadata.redirect_uris.includes(redirectUri)) {
      return yield* Effect.fail(
        new CimdRedirectUriMismatch({
          clientId: clientIdUrl,
          redirectUri,
          allowed: metadata.redirect_uris,
        }),
      );
    }

    const contentHash = cimdContentHash(metadata);
    yield* upsertCimdClient(clientIdUrl, metadata, contentHash);

    // A cache-write failure is not fatal — it only means the next request
    // re-fetches/re-upserts (a no-op against Hydra, since the content hash
    // won't have changed), same as the PKCE-state write above.
    const cacheResult = yield* Effect.either(
      redisOps.setCimdMetadata(
        clientIdUrl,
        { metadata, contentHash, fetchedAt: Date.now() },
        appConfig.cimd.cacheTtlSeconds,
      ),
    );
    if (cacheResult._tag === 'Left') {
      syncLogger.error('Failed to cache CIMD metadata in Redis', {
        clientIdUrl,
        error: cacheResult.left,
      });
    }

    return metadata;
  });

/**
 * Enhanced proxy middleware with validation
 * Validates required OAuth2 parameters and returns 400 for fatal errors
 */
const enhancedProxyMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  // app-fp.ts mounts this under /oauth2/auth and /oauth2/register, which strips the mount
  // path from req.path, so match on the full original path instead
  const { pathname } = new URL(req.originalUrl, 'http://localhost');
  if (pathname === '/oauth2/auth') {
    syncLogger.info('=== OAUTH2 AUTHORIZATION ENDPOINT ===', {
      method: req.method,
      path: pathname,
      query: req.query,
      session_id: req.session.id,
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
        origin: req.headers.origin,
        referer: req.headers.referer,
      },
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });

    const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, scope, state } = req.query;

    // Fatal validation errors that should return 400
    const missingParams: string[] = [];

    if (!client_id) missingParams.push('client_id');
    if (!redirect_uri) missingParams.push('redirect_uri');
    if (!response_type) missingParams.push('response_type');

    if (missingParams.length > 0) {
      syncLogger.error('=== OAUTH2 AUTH ERROR: Missing Parameters ===', {
        missingParams,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      return res.status(400).json({
        error: 'invalid_request',
        error_description: `Missing required parameters: ${missingParams.join(', ')}`,
      });
    }

    // Validate response_type
    if (response_type !== 'code') {
      syncLogger.error('=== OAUTH2 AUTH ERROR: Invalid Response Type ===', {
        response_type,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      return res.status(400).json({
        error: 'unsupported_response_type',
        error_description: 'Only response_type=code is supported',
      });
    }

    // CIMD (Client ID Metadata Document) clients present an https:// URL as
    // client_id instead of a Hydra-issued DCR id. Existing DCR clients fall
    // straight through unchanged — this only branches for URL-shaped ids.
    if (appConfig.cimd.enabled && isHttpsUrlClientId(String(client_id))) {
      const outcome = await Effect.runPromise(
        Effect.either(Effect.provide(runCimdPipeline(String(client_id), String(redirect_uri)), cimdLayer)),
      );
      if (outcome._tag === 'Left') {
        syncLogger.error('=== OAUTH2 AUTH ERROR: CIMD validation failed ===', {
          client_id,
          error: outcome.left,
          timestamp: new Date().toISOString(),
        });
        return res.status(400).json({
          error: 'invalid_client',
          error_description: describeCimdError(outcome.left),
        });
      }
    }

    // Log PKCE parameters
    syncLogger.info('OAUTH2 AUTH: PKCE Parameters', {
      has_code_challenge: !!code_challenge,
      code_challenge_method: code_challenge_method ?? 'not provided',
      has_state: !!state,
      scope,
      timestamp: new Date().toISOString(),
    });
  } else if (pathname.startsWith('/oauth2/register')) {
    syncLogger.info('=== OAUTH2 CLIENT REGISTRATION ENDPOINT ===', {
      method: req.method,
      path: pathname,
      body: req.body,
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
        origin: req.headers.origin,
      },
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
  }

  // Continue to proxy
  next();
};

// Export the middleware with validation wrapper
export default [enhancedProxyMiddleware, createProxyMiddleware(proxyOptions)];
