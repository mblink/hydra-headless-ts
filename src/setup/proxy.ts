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
import { findDisallowedRedirectUri, isRedirectUriAllowed } from '../fp/services/redirectUri.js';
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

const AUTHORIZE_PARAMS = [
  'client_id',
  'redirect_uri',
  'response_type',
  'code_challenge',
  'code_challenge_method',
  'scope',
  'state',
] as const;
type AuthorizeParam = (typeof AUTHORIZE_PARAMS)[number];

// BASE64URL(SHA-256(verifier)) is always 43 characters without padding
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

// The flow id the validating middleware stored the PKCE state under, for pathRewrite to put in
// the query string sent to Hydra
const flowIds = new WeakMap<Request, string>();

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
      // Mounting under /oauth2/register strips the path, so send the original one. /oauth2/auth
      // gets its path from pathRewrite (with the flow id as state), which this must not undo.
      if (parsed.pathname !== '/oauth2/auth') {
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
      const flowId = flowIds.get(req);
      if (!flowId) {
        throw new Error('/oauth2/auth reached the proxy without a stored flow');
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
    // pathRewrite swaps the client's state and PKCE challenge in the query string for a flow id, so
    // only GET (which RFC 6749 requires the authorization endpoint to support) can be handled
    if (req.method !== 'GET') {
      return res.status(405).set('Allow', 'GET').json({
        error: 'invalid_request',
        error_description: 'The authorization endpoint only supports GET',
      });
    }
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

    // Express turns a repeated parameter into an array. Hydra validates the first value, so the
    // app must not go on to use a different one (e.g. the joined "A,B" as redirect_uri).
    const repeatedParam = AUTHORIZE_PARAMS.find(
      (name) => req.query[name] !== undefined && typeof req.query[name] !== 'string',
    );
    if (repeatedParam) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: `${repeatedParam} must be given exactly once`,
      });
    }
    const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, scope, state } =
      req.query as Partial<Record<AuthorizeParam, string>>;

    // Fatal validation errors that should return 400
    const missingParams: string[] = [];

    if (!client_id) missingParams.push('client_id');
    // OAuth lets a client with one registered redirect URI omit it, but /callback redirects to the
    // stored redirect_uri itself rather than through Hydra, so the flow can't finish without it
    if (!redirect_uri) missingParams.push('redirect_uri');
    if (!response_type) missingParams.push('response_type');
    // The token endpoint checks the verifier against the stored challenge, and the callback
    // returns the client's state, so the flow can't finish without either
    if (!code_challenge) missingParams.push('code_challenge');
    if (!state) missingParams.push('state');

    if (!client_id || !redirect_uri || !response_type || !code_challenge || !state) {
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

    // Hydra checks redirect_uri against the client's registration, but anyone can register a
    // client, so the registered URI also has to be one this deployment trusts
    if (!isRedirectUriAllowed(redirect_uri, appConfig.redirectUris)) {
      syncLogger.warn('=== OAUTH2 AUTH ERROR: redirect_uri not allowed ===', { client_id, redirect_uri });
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'redirect_uri is not allowed',
      });
    }

    // RFC 7636 makes a missing method mean plain, which leaves the verifier in the front channel
    if (code_challenge_method !== 'S256') {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'code_challenge_method must be S256',
      });
    }
    if (!S256_CHALLENGE.test(code_challenge)) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'code_challenge must be a base64url-encoded SHA-256 hash',
      });
    }

    // CIMD (Client ID Metadata Document) clients present an https:// URL as
    // client_id instead of a Hydra-issued DCR id. Existing DCR clients fall
    // straight through unchanged — this only branches for URL-shaped ids.
    if (appConfig.cimd.enabled && isHttpsUrlClientId(client_id)) {
      const outcome = await Effect.runPromise(
        Effect.either(Effect.provide(runCimdPipeline(client_id, redirect_uri), cimdLayer)),
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

    // One id per authorization request, so overlapping flows in the same browser don't share
    // state. It keys the PKCE state in Redis and replaces the client's `state` on the way to
    // Hydra; consent reads it back from Hydra's request_url and sends it to Google as `state`,
    // and the callback looks the flow up by it.
    const flowId = randomBytes(32).toString('base64url');
    // Writing to the session makes express-session persist it and set its cookie, so the
    // callback can check it comes from the browser that started the flow
    req.session.oauthFlowStartedAt = Date.now();

    const pkceData: PKCEState = {
      code_challenge,
      code_challenge_method,
      scope: scope ?? '',
      state,
      redirect_uri,
      client_id,
      timestamp: Date.now(),
      session_id: req.session.id,
    };
    const stored = await Effect.runPromise(
      Effect.either(
        Effect.provide(
          Effect.flatMap(RedisService, (redis) => createOAuthRedisOps(redis).setPKCEState(flowId, pkceData, 3600)),
          redisLayer,
        ),
      ),
    );
    // Without the stored state the callback can't finish the flow, so stop before the user logs in
    if (stored._tag === 'Left') {
      syncLogger.error('Failed to store PKCE state in Redis', { error: stored.left });
      return res.status(503).json({
        error: 'temporarily_unavailable',
        error_description: 'Could not start the authorization flow',
      });
    }
    flowIds.set(req, flowId);
  } else if (pathname.startsWith('/oauth2/register')) {
    // Creating (POST) and updating (PUT, RFC 7592) a client both set its redirect_uris
    if (req.method === 'POST' || req.method === 'PUT') {
      const rejected = findDisallowedRedirectUri(req.body?.redirect_uris, appConfig.redirectUris);
      if (rejected) {
        syncLogger.warn('=== OAUTH2 CLIENT REGISTRATION REJECTED ===', {
          reason: rejected,
          user_agent: req.headers['user-agent'],
        });
        return res.status(400).json({ error: 'invalid_redirect_uri', error_description: rejected });
      }
    }
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
