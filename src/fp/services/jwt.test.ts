import axios from 'axios';
import { Effect } from 'effect';
import { exportJWK, generateKeyPair, jwtVerify, decodeProtectedHeader, type JWK } from 'jose';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { ParseError } from '../errors.js';
import { makeJWTService, type JWTConfig } from './jwt.js';

vi.mock('axios');

const hydraConfig: JWTConfig = {
  provider: 'hydra',
  issuer: 'https://auth.example.com',
  audience: 'https://client.example.com',
  hydraPublicUrl: 'https://hydra.example.com',
  hydraAdminUrl: 'https://hydra-admin.example.com',
};

const claims = {
  sub: 'user@example.com',
  scope: 'openid email',
  client_id: 'client-123',
  jti: 'jti-abc',
};

describe('JWTService', () => {
  let privateJwk: JWK;
  let publicKey: CryptoKey;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256', { extractable: true });
    publicKey = pair.publicKey as CryptoKey;
    privateJwk = {
      ...(await exportJWK(pair.privateKey)),
      kid: 'test-kid',
      alg: 'RS256',
      use: 'sig',
    };
  });

  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
  });

  describe('hydra provider', () => {
    it('fetches the signing key from the Hydra admin API', async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { keys: [privateJwk] } });

      const service = makeJWTService(hydraConfig);
      await Effect.runPromise(service.sign(claims, 60));

      expect(axios.get).toHaveBeenCalledWith(
        'https://hydra-admin.example.com/admin/keys/hydra.jwt.access-token',
        expect.any(Object),
      );
    });

    it('signs a verifiable RS256 JWT with issuer, audience, kid and expiry', async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { keys: [privateJwk] } });

      const service = makeJWTService(hydraConfig);
      const token = await Effect.runPromise(service.sign(claims, 120));

      const header = decodeProtectedHeader(token);
      expect(header).toMatchObject({
        alg: 'RS256',
        typ: 'JWT',
        kid: 'test-kid',
      });

      const { payload } = await jwtVerify(token, publicKey, {
        issuer: hydraConfig.issuer,
        audience: hydraConfig.audience,
      });
      expect(payload).toMatchObject({ ...claims, kid: 'test-kid' });
      expect(payload.exp! - payload.iat!).toBe(120);
    });

    it('caches the key across sign calls', async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { keys: [privateJwk] } });

      const service = makeJWTService(hydraConfig);
      await Effect.runPromise(service.sign(claims, 60));
      await Effect.runPromise(service.sign(claims, 60));

      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('ignores a Google ID token and still signs its own JWT', async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { keys: [privateJwk] } });

      const service = makeJWTService(hydraConfig);
      const token = await Effect.runPromise(service.sign(claims, 60, 'google-id-token'));

      expect(token).not.toBe('google-id-token');
      expect(token.split('.')).toHaveLength(3);
    });

    it('fails with ParseError when Hydra returns no keys', async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { keys: [] } });

      const service = makeJWTService(hydraConfig);
      const result = await Effect.runPromise(Effect.either(service.sign(claims, 60)));

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ParseError);
      }
    });

    it('fails with ParseError when the key has no kid', async () => {
      const { kid: _kid, ...noKid } = privateJwk;
      vi.mocked(axios.get).mockResolvedValue({ data: { keys: [noKid] } });

      const service = makeJWTService(hydraConfig);
      const result = await Effect.runPromise(Effect.either(service.sign(claims, 60)));

      expect(result._tag).toBe('Left');
    });

    it('fails with ParseError when the key fetch fails', async () => {
      vi.mocked(axios.get).mockRejectedValue(new Error('connection refused'));

      const service = makeJWTService(hydraConfig);
      const result = await Effect.runPromise(Effect.either(service.sign(claims, 60)));

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ParseError);
        expect(result.left.message).toContain('connection refused');
      }
    });

    it('getJWKS fetches the Hydra public JWKS', async () => {
      const jwks = { keys: [{ kid: 'test-kid', kty: 'RSA' }] };
      vi.mocked(axios.get).mockImplementation(async (url: string) =>
        url.endsWith('/.well-known/jwks.json') ? { data: jwks } : { data: { keys: [privateJwk] } },
      );

      const service = makeJWTService(hydraConfig);
      const result = await Effect.runPromise(service.getJWKS());

      expect(result).toEqual(jwks);
      expect(axios.get).toHaveBeenCalledWith('https://hydra.example.com/.well-known/jwks.json');
    });
  });

  describe('google provider', () => {
    const googleConfig: JWTConfig = { ...hydraConfig, provider: 'google' };

    it('does not fetch Hydra keys', async () => {
      makeJWTService(googleConfig);
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('returns the Google ID token as the access token', async () => {
      const service = makeJWTService(googleConfig);
      const token = await Effect.runPromise(service.sign(claims, 60, 'google-id-token'));
      expect(token).toBe('google-id-token');
    });

    it('fails when no Google ID token is provided', async () => {
      const service = makeJWTService(googleConfig);
      const result = await Effect.runPromise(Effect.either(service.sign(claims, 60)));

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ParseError);
      }
    });

    it('getJWKS fetches Google certs', async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { keys: [] } });

      const service = makeJWTService(googleConfig);
      await Effect.runPromise(service.getJWKS());

      expect(axios.get).toHaveBeenCalledWith('https://www.googleapis.com/oauth2/v3/certs');
    });
  });

  describe('generateJti', () => {
    it('returns unique base64url ids', async () => {
      const service = makeJWTService({ ...hydraConfig, provider: 'google' });
      const ids = await Promise.all(Array.from({ length: 50 }, () => Effect.runPromise(service.generateJti())));

      expect(new Set(ids).size).toBe(50);
      expect(ids.every((id) => /^[A-Za-z0-9_-]{22}$/.test(id))).toBe(true);
    });
  });
});
