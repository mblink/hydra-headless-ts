import crypto from 'crypto';
import { Effect, Layer } from 'effect';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GoogleAuthError,
  InvalidGrant,
  InvalidPKCE,
  InvalidScope,
  MissingParameter,
  RedisKeyNotFound,
} from '../errors.js';
import { GoogleOAuthService } from './google.js';
import { JWTService } from './jwt.js';
import { RedisService, makeRedisService } from './redis.js';
import { processAuthCodeGrant, processRefreshTokenGrant } from './token.js';
import type { GoogleTokenData, JWTRefreshData } from '../domain.js';
import type { Redis } from 'ioredis';

const createMemoryRedis = () => {
  const store = new Map<string, string>();
  const client = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => keys.filter((k) => store.delete(k)).length),
    exists: vi.fn(async (...keys: string[]) => keys.filter((k) => store.has(k)).length),
  } as unknown as Redis;
  return { store, client };
};

const readJSON = (store: Map<string, string>, key: string) => {
  const raw = store.get(key);
  return raw === undefined ? undefined : JSON.parse(raw);
};

const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

describe('token service', () => {
  let store: Map<string, string>;
  let redisClient: Redis;
  let jwtSign: ReturnType<typeof vi.fn>;
  let googleRefresh: ReturnType<typeof vi.fn>;
  let layer: Layer.Layer<RedisService | JWTService | GoogleOAuthService>;

  beforeEach(() => {
    const mem = createMemoryRedis();
    store = mem.store;
    redisClient = mem.client;

    jwtSign = vi.fn((claims: { jti: string }, expiresIn: number) => Effect.succeed(`jwt:${claims.jti}:${expiresIn}`));
    googleRefresh = vi.fn();

    layer = Layer.mergeAll(
      Layer.succeed(RedisService, makeRedisService(redisClient)),
      Layer.succeed(JWTService, {
        sign: jwtSign,
        verify: vi.fn(),
        generateJti: () => Effect.succeed('jti-1'),
        getJWKS: vi.fn(),
      } as unknown as JWTService),
      Layer.succeed(GoogleOAuthService, {
        refreshToken: googleRefresh,
      } as unknown as GoogleOAuthService),
    );
  });

  const run = <A, E>(effect: Effect.Effect<A, E, RedisService | JWTService | GoogleOAuthService>) =>
    Effect.runPromise(Effect.either(Effect.provide(effect, layer)));

  describe('processAuthCodeGrant', () => {
    const seedAuthCode = (method: 'S256' | 'plain' = 'S256', codeChallenge = challenge, googleExpiresAt?: number) => {
      store.set(
        'auth_code:code-1',
        JSON.stringify({
          google_tokens: {
            tokens: {
              access_token: 'g-access',
              refresh_token: 'g-refresh',
              id_token: 'g-id',
              expires_in: 3600,
              scope: 'openid email',
              token_type: 'Bearer',
            },
          },
          subject: 'user@example.com',
          ...(googleExpiresAt === undefined ? {} : { google_expires_at: googleExpiresAt }),
        }),
      );
      store.set(
        'auth_code_state:code-1',
        JSON.stringify({
          code_challenge: codeChallenge,
          code_challenge_method: method,
          client_id: 'client-1',
          redirect_uri: 'https://client.example.com/cb',
          scope: 'openid email',
          state: 'xyz',
          timestamp: Date.now(),
        }),
      );
    };

    const grant = (code_verifier = verifier) => ({
      grant_type: 'authorization_code' as const,
      code: 'code-1',
      code_verifier,
      redirect_uri: 'https://client.example.com/cb',
      client_id: 'client-1',
    });

    it('exchanges a valid code for a JWT and our own refresh token', async () => {
      seedAuthCode();

      const result = await run(processAuthCodeGrant(grant()));

      expect(result._tag).toBe('Right');
      if (result._tag !== 'Right') return;
      const response = result.right;
      expect(response).toMatchObject({
        access_token: 'jwt:jti-1:3600',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid email',
      });
      // Our refresh token, not Google's
      expect(response.refresh_token).not.toBe('g-refresh');
      expect(response.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      expect(jwtSign).toHaveBeenCalledWith(
        {
          sub: 'user@example.com',
          scope: 'openid email',
          client_id: 'client-1',
          jti: 'jti-1',
        },
        3600,
        'g-id',
      );
    });

    it('stores Google tokens by JTI and maps the refresh token to the JTI', async () => {
      seedAuthCode();

      const result = await run(processAuthCodeGrant(grant()));
      if (result._tag !== 'Right') throw new Error('expected success');

      const googleData = readJSON(store, 'google_token:jti-1') as GoogleTokenData;
      expect(googleData).toMatchObject({
        google_access_token: 'g-access',
        google_refresh_token: 'g-refresh',
        google_id_token: 'g-id',
        subject: 'user@example.com',
        client_id: 'client-1',
      });
      expect(googleData.expires_at).toBeGreaterThan(Date.now() + 3500 * 1000);

      const refreshData = readJSON(store, `jwt_refresh:${result.right.refresh_token}`) as JWTRefreshData;
      expect(refreshData).toMatchObject({
        jti: 'jti-1',
        client_id: 'client-1',
        subject: 'user@example.com',
      });
    });

    it('deletes the auth code and its state so the code is single-use', async () => {
      seedAuthCode();

      await run(processAuthCodeGrant(grant()));
      expect(store.has('auth_code:code-1')).toBe(false);
      expect(store.has('auth_code_state:code-1')).toBe(false);

      const replay = await run(processAuthCodeGrant(grant()));
      expect(replay._tag).toBe('Left');
      if (replay._tag === 'Left') {
        expect(replay.left).toBeInstanceOf(RedisKeyNotFound);
      }
    });

    it('rejects a wrong code_verifier and still consumes the code', async () => {
      seedAuthCode();

      const result = await run(processAuthCodeGrant(grant('not-the-verifier')));

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(InvalidPKCE);
      }
      expect(store.has('auth_code:code-1')).toBe(false);
      expect(jwtSign).not.toHaveBeenCalled();
      expect(store.has('google_token:jti-1')).toBe(false);
    });

    it('supports the plain PKCE method', async () => {
      seedAuthCode('plain', 'plain-verifier');

      const result = await run(processAuthCodeGrant(grant('plain-verifier')));

      expect(result._tag).toBe('Right');
    });

    it('measures the Google token lifetime at exchange time from google_expires_at', async () => {
      // Stored expires_in (3600) is stale; the absolute expiry is what counts
      const googleExpiresAt = Date.now() + 1000 * 1000;
      seedAuthCode('S256', challenge, googleExpiresAt);

      const result = await run(processAuthCodeGrant(grant()));

      expect(result._tag).toBe('Right');
      if (result._tag !== 'Right') return;
      expect(result.right.expires_in).toBeGreaterThan(990);
      expect(result.right.expires_in).toBeLessThanOrEqual(1000);
      expect(jwtSign).toHaveBeenCalledWith(expect.objectContaining({ jti: 'jti-1' }), result.right.expires_in, 'g-id');
      const googleData = readJSON(store, 'google_token:jti-1') as GoogleTokenData;
      expect(googleData.expires_at).toBe(googleExpiresAt);
    });

    it('rejects the exchange when the Google token has already expired', async () => {
      seedAuthCode('S256', challenge, Date.now() - 1000);

      const result = await run(processAuthCodeGrant(grant()));

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(InvalidGrant);
      }
      expect(jwtSign).not.toHaveBeenCalled();
      expect(store.has('google_token:jti-1')).toBe(false);
    });

    it('fails when the auth code is unknown', async () => {
      const result = await run(processAuthCodeGrant(grant()));

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(RedisKeyNotFound);
      }
    });
  });

  describe('processRefreshTokenGrant', () => {
    const seedRefresh = (expiresAt: number) => {
      store.set(
        'jwt_refresh:our-refresh',
        JSON.stringify({
          jti: 'jti-9',
          client_id: 'client-1',
          scope: 'openid email',
          subject: 'user@example.com',
          created_at: Date.now(),
        }),
      );
      store.set(
        'google_token:jti-9',
        JSON.stringify({
          google_access_token: 'g-access',
          google_refresh_token: 'g-refresh',
          google_id_token: 'g-id',
          scope: 'openid email',
          subject: 'user@example.com',
          client_id: 'client-1',
          expires_at: expiresAt,
          updated_at: Date.now(),
        }),
      );
    };

    const grant = (scope?: string) => ({
      grant_type: 'refresh_token' as const,
      refresh_token: 'our-refresh',
      client_id: 'client-1',
      ...(scope ? { scope } : {}),
    });

    it('reissues a JWT without calling Google while the Google token is fresh', async () => {
      seedRefresh(Date.now() + 30 * 60 * 1000);

      const result = await run(processRefreshTokenGrant(grant()));

      expect(result._tag).toBe('Right');
      if (result._tag !== 'Right') return;
      expect(googleRefresh).not.toHaveBeenCalled();
      expect(result.right.refresh_token).toBe('our-refresh');
      expect(result.right.access_token).toMatch(/^jwt:jti-9:/);
      expect(result.right.expires_in).toBeGreaterThan(29 * 60);
      expect(result.right.expires_in).toBeLessThanOrEqual(30 * 60);
    });

    it('refreshes with Google when the token expires within 5 minutes', async () => {
      seedRefresh(Date.now() + 60 * 1000);
      googleRefresh.mockReturnValue(
        Effect.succeed({
          access_token: 'g-access-2',
          expires_in: 3599,
          scope: 'openid email',
          token_type: 'Bearer',
          id_token: 'g-id-2',
        }),
      );

      const result = await run(processRefreshTokenGrant(grant()));

      expect(result._tag).toBe('Right');
      if (result._tag !== 'Right') return;
      expect(googleRefresh).toHaveBeenCalledWith(
        expect.objectContaining({
          refresh_token: 'g-refresh',
          client_id: 'client-1',
        }),
      );
      expect(result.right.expires_in).toBe(3599);
      expect(jwtSign).toHaveBeenCalledWith(expect.objectContaining({ jti: 'jti-9' }), 3599, 'g-id-2');

      const stored = readJSON(store, 'google_token:jti-9') as GoogleTokenData;
      expect(stored.google_access_token).toBe('g-access-2');
      // Google did not rotate the refresh token, so the old one is kept
      expect(stored.google_refresh_token).toBe('g-refresh');
    });

    it('propagates Google refresh failures', async () => {
      seedRefresh(Date.now() - 1000);
      googleRefresh.mockReturnValue(
        Effect.fail(
          new GoogleAuthError({
            error: 'invalid_grant',
            errorDescription: 'revoked',
          }),
        ),
      );

      const result = await run(processRefreshTokenGrant(grant()));

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(GoogleAuthError);
      }
    });

    it('allows a narrower requested scope', async () => {
      seedRefresh(Date.now() + 30 * 60 * 1000);

      const result = await run(processRefreshTokenGrant(grant('openid')));

      expect(result._tag).toBe('Right');
    });

    it('rejects a scope that was not originally granted', async () => {
      seedRefresh(Date.now() + 30 * 60 * 1000);

      const result = await run(processRefreshTokenGrant(grant('openid admin')));

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(InvalidScope);
      }
    });

    it('fails for an unknown refresh token', async () => {
      const result = await run(processRefreshTokenGrant(grant()));

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(RedisKeyNotFound);
      }
    });

    it('fails with MissingParameter for an empty refresh token', async () => {
      const result = await run(
        processRefreshTokenGrant({
          grant_type: 'refresh_token',
          refresh_token: '',
          client_id: 'c',
        } as never),
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(MissingParameter);
      }
    });
  });
});
