import { Effect, Either, Layer } from 'effect';
import { describe, it, expect, vi, beforeEach, assert } from 'vitest';
import { GoogleAuthError, InvalidState, UnauthorizedEmail } from '../errors.js';
import { processCallback, type GoogleOAuthClient } from './callback.js';
import { isEmailAllowed } from './emailAllowlist.js';
import { RedisService } from './redis.js';
import type { PKCEState } from '../domain.js';

vi.mock('./emailAllowlist.js', () => ({ isEmailAllowed: vi.fn() }));
vi.mock('../../logging-effect.js', () => ({
  syncLogger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

// Fixture: valid PKCE state stored in Redis by the /oauth2/auth proxy
const validPKCEState: PKCEState = {
  code_challenge: 'test-challenge-abc123',
  code_challenge_method: 'S256',
  scope: 'openid',
  state: 'test-state-xyz',
  redirect_uri: 'https://client.example.com/callback',
  client_id: 'test-client',
  timestamp: Date.now(),
  session_id: 'session-1',
};

// Fixture: Google token response with all fields
const fullGoogleTokens = {
  tokens: {
    access_token: 'ga-access-token',
    refresh_token: 'ga-refresh-token',
    scope: 'openid',
    expires_in: 3600,
    token_type: 'Bearer',
    id_token: 'google-id-token',
  },
};

const config = {
  middlewareRedirectUri: 'https://auth.example.com/callback',
  googleClientId: 'google-client-id',
};

const makeTestRedis = (pkceState: object = validPKCEState) => {
  const getJSON = vi.fn().mockReturnValue(Effect.succeed(pkceState));
  const setJSON = vi.fn().mockReturnValue(Effect.succeed('OK' as const));
  const del = vi.fn().mockReturnValue(Effect.succeed(1));
  const redis = {
    get: () => Effect.succeed(null),
    getJSON,
    set: () => Effect.succeed('OK' as const),
    setJSON,
    del,
    exists: () => Effect.succeed(1),
  } as unknown as RedisService;
  return { redis, getJSON, setJSON, del };
};

// google-auth-library's verifyIdToken() resolves to a LoginTicket
type IdTokenPayload = { sub: string; email?: string; email_verified?: boolean };
const verifiedAs = (payload: IdTokenPayload | undefined) => vi.fn().mockResolvedValue({ getPayload: () => payload });

const makeGoogleClient = (
  payload: IdTokenPayload | undefined = {
    sub: 'google-user-123',
    email: 'user@bondlink.com',
    email_verified: true,
  },
  overrideTokens?: object,
) =>
  ({
    getToken: vi.fn().mockResolvedValue(overrideTokens ?? fullGoogleTokens),
    verifyIdToken: verifiedAs(payload),
  }) satisfies GoogleOAuthClient;

const run = (redis: RedisService, googleClient?: GoogleOAuthClient, sessionId = 'session-1') =>
  Effect.runPromise(
    Effect.either(
      Effect.provide(
        processCallback('google-code-123', 'flow-1', sessionId, googleClient ?? makeGoogleClient(), config),
        Layer.succeed(RedisService, redis),
      ),
    ),
  );

describe('processCallback email choke point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when the email from the ID token is not in the allowlist', async () => {
    vi.mocked(isEmailAllowed).mockReturnValue(false);

    const { redis } = makeTestRedis();
    const result = await run(redis, makeGoogleClient({ sub: 'g-1', email: 'blocked@gmail.com', email_verified: true }));

    expect(result._tag).toBe('Left');
    assert(Either.isLeft(result));
    expect(result.left).toBeInstanceOf(UnauthorizedEmail);
    expect((result.left as UnauthorizedEmail).email).toBe('blocked@gmail.com');
    expect(isEmailAllowed).toHaveBeenCalledWith('blocked@gmail.com');
  });

  it('rejects with <missing> when the ID token has no email field', async () => {
    const { redis } = makeTestRedis();
    const result = await run(redis, makeGoogleClient({ sub: 'g-1' }));

    expect(result._tag).toBe('Left');
    assert(Either.isLeft(result));
    expect(result.left).toBeInstanceOf(UnauthorizedEmail);
    expect((result.left as UnauthorizedEmail).email).toBe('<missing>');
    expect(isEmailAllowed).not.toHaveBeenCalled();
  });

  it('rejects an allowlisted email that Google has not verified', async () => {
    vi.mocked(isEmailAllowed).mockReturnValue(true);

    const { redis } = makeTestRedis();
    const result = await run(
      redis,
      makeGoogleClient({ sub: 'g-1', email: 'user@bondlink.com', email_verified: false }),
    );

    expect(result._tag).toBe('Left');
    assert(Either.isLeft(result));
    expect(result.left).toBeInstanceOf(UnauthorizedEmail);
    expect(isEmailAllowed).not.toHaveBeenCalled();
  });

  it('rejects with GoogleAuthError when Google returns no ID token', async () => {
    const { redis } = makeTestRedis();
    const result = await run(
      redis,
      makeGoogleClient(undefined, {
        tokens: {
          access_token: 'ga-access-token',
          scope: 'openid',
          expires_in: 3600,
          token_type: 'Bearer',
          // no id_token
        },
      }),
    );

    expect(result._tag).toBe('Left');
    assert(Either.isLeft(result));
    expect(result.left).toBeInstanceOf(GoogleAuthError);
    expect((result.left as GoogleAuthError).error).toBe('missing_id_token');
    expect(isEmailAllowed).not.toHaveBeenCalled();
  });

  it('rejects with GoogleAuthError when the ID token does not verify', async () => {
    const { redis } = makeTestRedis();
    const googleClient = makeGoogleClient();
    googleClient.verifyIdToken.mockRejectedValue(new Error('Wrong recipient, payload audience != requiredAudience'));

    const result = await run(redis, googleClient);

    expect(result._tag).toBe('Left');
    assert(Either.isLeft(result));
    expect(result.left).toBeInstanceOf(GoogleAuthError);
    expect((result.left as GoogleAuthError).error).toBe('invalid_id_token');
    expect(isEmailAllowed).not.toHaveBeenCalled();
  });

  it('rejects with GoogleAuthError when Google returns no access token', async () => {
    const { redis } = makeTestRedis();
    const result = await run(
      redis,
      makeGoogleClient(undefined, {
        tokens: {
          // no access_token
          scope: 'openid',
          expires_in: 3600,
          token_type: 'Bearer',
          id_token: 'google-id-token',
        },
      }),
    );

    expect(result._tag).toBe('Left');
    assert(Either.isLeft(result));
    expect(result.left).toBeInstanceOf(GoogleAuthError);
    expect((result.left as GoogleAuthError).error).toBe('missing_access_token');
  });

  it('returns a redirect URL when the email is in the allowlist', async () => {
    vi.mocked(isEmailAllowed).mockReturnValue(true);

    const { redis, setJSON } = makeTestRedis();
    const googleClient = makeGoogleClient();
    const result = await run(redis, googleClient);

    expect(result._tag).toBe('Right');
    assert(Either.isRight(result));
    expect(result.right).toContain('https://client.example.com/callback');
    expect(result.right).toContain('code=');
    expect(result.right).toContain('state=test-state-xyz');
    expect(isEmailAllowed).toHaveBeenCalledWith('user@bondlink.com');
    expect(googleClient.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'google-id-token',
      audience: 'google-client-id',
    });

    // The subject is the Google account id, not a placeholder
    const authCodeWrite = setJSON.mock.calls.find(([key]) => String(key).startsWith('auth_code:'));
    expect(authCodeWrite?.[1]).toMatchObject({ subject: 'google-user-123' });
  });
});

describe('processCallback state binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isEmailAllowed).mockReturnValue(true);
  });

  it('looks the flow up by the state Google returned', async () => {
    const { redis, getJSON, del } = makeTestRedis();

    const result = await run(redis);

    expect(result._tag).toBe('Right');
    expect(getJSON.mock.calls[0][0]).toBe('pkce_session:flow-1');
    expect(del).toHaveBeenCalledWith('pkce_session:flow-1');
  });

  it('rejects a callback from a different session without exchanging the code', async () => {
    const { redis, del } = makeTestRedis();
    const googleClient = makeGoogleClient();

    const result = await run(redis, googleClient, 'attacker-session');

    expect(result._tag).toBe('Left');
    assert(Either.isLeft(result));
    expect(result.left).toBeInstanceOf(InvalidState);
    expect(googleClient.getToken).not.toHaveBeenCalled();
    // The flow's real owner can still finish it
    expect(del).not.toHaveBeenCalled();
  });

  it('rejects a flow stored without a session id', async () => {
    const { session_id: _, ...legacy } = validPKCEState;
    const { redis } = makeTestRedis(legacy);
    const googleClient = makeGoogleClient();

    const result = await run(redis, googleClient);

    expect(result._tag).toBe('Left');
    assert(Either.isLeft(result));
    expect(result.left).toBeInstanceOf(InvalidState);
    expect(googleClient.getToken).not.toHaveBeenCalled();
  });
});
