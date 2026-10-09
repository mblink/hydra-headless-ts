/**
 * Token validation endpoint for testing JWT tokens
 * GET /validate-token?token=<jwt> or with Authorization: Bearer <jwt> header
 */
import { Router } from 'express';
import { Effect, Layer } from 'effect';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import axios from 'axios';
import { JWTService, type JWKS } from '../fp/services/jwt.js';
import { appConfig } from '../config.js';
import type { Request, Response } from 'express';

export const createValidateTokenRouter = (serviceLayer: Layer.Layer<any>) => {
  const router = Router();

  /**
   * GET /validate-token
   * Validates a JWT token and returns detailed information
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      // Get token from query parameter or Authorization header
      let token = req.query.token as string | undefined;

      if (!token) {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
          token = authHeader.substring(7);
        }
      }

      if (!token) {
        return res.status(400).json({
          error: 'No token provided',
          message: 'Provide token via ?token=<jwt> or Authorization: Bearer <jwt> header',
        });
      }

      // Decode token header and payload (without verification)
      let header: any;
      let payload: any;

      try {
        header = decodeProtectedHeader(token);
        payload = decodeJwt(token);
      } catch (error) {
        return res.status(400).json({
          error: 'Invalid token format',
          message: 'Token could not be decoded',
          details: String(error),
        });
      }

      // Fetch JWKS based on configured provider
      const jwksUrl =
        appConfig.jwtProvider === 'google'
          ? 'https://www.googleapis.com/oauth2/v3/certs'
          : `${appConfig.hydraPublicUrl}/.well-known/jwks.json`;

      let jwks: JWKS;
      try {
        const response = await axios.get<JWKS>(jwksUrl);
        jwks = response.data;
      } catch (error) {
        return res.status(500).json({
          error: 'Failed to fetch JWKS',
          message: String(error),
          provider: appConfig.jwtProvider,
        });
      }

      // Verify token using JWT service
      const program = Effect.gen(function* () {
        const jwt = yield* JWTService;
        const verifiedClaims = yield* jwt.verify(token);
        return verifiedClaims;
      });

      try {
        const verifiedClaims = await Effect.runPromise(Effect.provide(program, serviceLayer));

        const now = Math.floor(Date.now() / 1000);
        const timeUntilExpiry = verifiedClaims.exp - now;

        return res.json({
          valid: true,
          provider: appConfig.jwtProvider,
          header,
          claims: verifiedClaims,
          jwks: {
            url: jwksUrl,
            keys: jwks.keys.map((key) => ({
              kid: key.kid,
              kty: key.kty,
              alg: key.alg,
              use: key.use,
            })),
          },
          validation: {
            kid: header.kid,
            kid_found_in_jwks: jwks.keys.some((k) => k.kid === header.kid),
            subject: verifiedClaims.sub,
            client_id: verifiedClaims.client_id,
            scopes: verifiedClaims.scope,
            jti: verifiedClaims.jti,
            issued_at: new Date(verifiedClaims.iat * 1000).toISOString(),
            expires_at: new Date(verifiedClaims.exp * 1000).toISOString(),
            time_until_expiry_seconds: timeUntilExpiry,
            is_expired: timeUntilExpiry <= 0,
          },
        });
      } catch (error) {
        return res.status(401).json({
          valid: false,
          provider: appConfig.jwtProvider,
          error: 'Token verification failed',
          message: String(error),
          header,
          unverified_claims: payload,
          jwks: {
            url: jwksUrl,
            keys: jwks.keys.map((key) => ({
              kid: key.kid,
              kty: key.kty,
              alg: key.alg,
              use: key.use,
            })),
          },
          possible_reasons: [
            'Token signature is invalid',
            'Token is expired',
            'Token issuer/audience does not match',
            'Token was not signed with a key in the JWKS',
          ],
        });
      }
    } catch (error) {
      return res.status(500).json({
        error: 'Internal server error',
        message: String(error),
      });
    }
  });

  return router;
};
