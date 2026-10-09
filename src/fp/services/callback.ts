/**
 * Google OAuth callback business logic using Effect
 */
import * as crypto from 'crypto';
import { Effect } from 'effect';
import { PKCEStateSchema } from '../domain.js';
import { type AppError, GoogleAuthError, InvalidState, UnauthorizedEmail } from '../errors.js';
import { isEmailAllowed } from './emailAllowlist.js';
import { RedisService, createOAuthRedisOps } from './redis.js';
import type { AuthCodeData } from '../domain.js';

/**
 * Configuration for callback
 */
export interface CallbackConfig {
  readonly middlewareRedirectUri: string;
  /** Expected audience of Google's ID token */
  readonly googleClientId: string;
}

/**
 * Google OAuth tokens (from google-auth-library)
 */
interface GoogleOAuthTokens {
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    scope?: string | null;
    expires_in?: number | null;
    // google-auth-library replaces expires_in with an absolute expiry_date (ms)
    expiry_date?: number | null;
    id_token?: string | null;
    token_type?: string | null;
  };
}

/**
 * Google OAuth client interface
 */
export interface GoogleOAuthClient {
  getToken(code: string): Promise<GoogleOAuthTokens>;
  verifyIdToken(options: { idToken: string; audience: string }): Promise<{
    getPayload(): { sub: string; email?: string; email_verified?: boolean } | undefined;
  }>;
}

/**
 * Exchange Google authorization code for tokens
 * Using google-auth-library OAuth2Client
 */
const exchangeGoogleCode = (
  code: string,
  redirectUri: string,
  googleClient: GoogleOAuthClient,
): Effect.Effect<GoogleOAuthTokens, GoogleAuthError> =>
  Effect.tryPromise({
    try: () => googleClient.getToken(code),
    catch: (error) =>
      new GoogleAuthError({
        error: 'token_exchange_failed',
        errorDescription: String(error),
      }),
  });

/**
 * Verify Google's ID token (signature, issuer, audience, expiry) and return its claims
 */
const verifyGoogleIdToken = (idToken: string, googleClient: GoogleOAuthClient, audience: string) =>
  Effect.tryPromise({
    try: () => googleClient.verifyIdToken({ idToken, audience }),
    catch: (error) => new GoogleAuthError({ error: 'invalid_id_token', errorDescription: String(error) }),
  }).pipe(
    Effect.flatMap((ticket) => {
      const payload = ticket.getPayload();
      return payload?.sub
        ? Effect.succeed(payload)
        : Effect.fail(
            new GoogleAuthError({
              error: 'invalid_id_token',
              errorDescription: 'Google ID token has no subject',
            }),
          );
    }),
  );

/**
 * Process OAuth callback
 * 1. Look up the flow by the returned state and check it belongs to this browser session
 * 2. Exchange Google auth code for tokens and verify the ID token
 * 3. Generate new auth_code for passthrough
 * 4. Store auth_code and state in Redis
 * 5. Delete PKCE session
 * 6. Build redirect URL with new auth_code
 */
export const processCallback = (
  googleCode: string,
  flowId: string,
  sessionId: string,
  googleClient: GoogleOAuthClient,
  config: CallbackConfig,
): Effect.Effect<string, AppError, RedisService> =>
  Effect.gen(function* () {
    // Access services
    const redis = yield* RedisService;

    const redisOps = createOAuthRedisOps(redis);

    yield* Effect.logInfo('Processing OAuth callback').pipe(
      Effect.annotateLogs({
        code: googleCode,
        flowId,
      }),
    );

    // Step 1: Fetch PKCE data from Redis by the state Google returned
    const pkceData = yield* redisOps.getPKCEState(flowId, PKCEStateSchema);

    // Reject a Google response for a flow another browser started (login CSRF)
    if (pkceData.session_id !== sessionId) {
      return yield* Effect.fail(new InvalidState({ reason: 'Authorization flow was started in a different session' }));
    }

    yield* Effect.logInfo('PKCE data fetched').pipe(
      Effect.annotateLogs({
        state: pkceData.state,
        challenge: pkceData.code_challenge,
      }),
    );

    // Step 2: Exchange Google code for tokens
    const googleTokens = yield* exchangeGoogleCode(googleCode, config.middlewareRedirectUri, googleClient);

    // Step 3: Ensure required fields are present
    if (!googleTokens.tokens.access_token) {
      return yield* Effect.fail(
        new GoogleAuthError({
          error: 'missing_access_token',
          errorDescription: 'Google did not return an access token',
        }),
      );
    }

    // Step 3.5: Validate email from Google ID token before storing anything
    const idToken = googleTokens.tokens.id_token;
    if (!idToken) {
      return yield* Effect.fail(
        new GoogleAuthError({
          error: 'missing_id_token',
          errorDescription: 'Google did not return an ID token — ensure openid scope is requested',
        }),
      );
    }

    const idPayload = yield* verifyGoogleIdToken(idToken, googleClient, config.googleClientId);
    // Google only vouches for the address when email_verified is true
    const email = idPayload.email_verified === true ? idPayload.email : undefined;
    if (!email || !isEmailAllowed(email)) {
      yield* Effect.logWarning('Blocked unauthorized email at callback').pipe(
        Effect.annotateLogs({ email: email ?? '<missing>' }),
      );
      return yield* Effect.fail(new UnauthorizedEmail({ email: email ?? '<missing>' }));
    }

    // Step 4: Generate new auth_code for passthrough
    const authCode = crypto.randomBytes(32).toString('base64url');

    // google-auth-library replaces Google's relative expires_in with an absolute expiry_date.
    // Store the absolute time so the delay before the code exchange isn't counted as lifetime.
    const now = Date.now();
    const googleExpiresAt = googleTokens.tokens.expiry_date ?? now + (googleTokens.tokens.expires_in ?? 3600) * 1000;

    const authData: AuthCodeData = {
      google_tokens: {
        tokens: {
          access_token: googleTokens.tokens.access_token,
          scope: googleTokens.tokens.scope ?? '',
          expires_in: Math.max(0, Math.round((googleExpiresAt - now) / 1000)),
          token_type: googleTokens.tokens.token_type ?? 'Bearer',
          refresh_token: googleTokens.tokens.refresh_token ?? undefined,
          id_token: googleTokens.tokens.id_token ?? undefined,
        },
      },
      // Google's stable account id; unlike the email it never changes or gets reassigned
      subject: idPayload.sub,
      google_expires_at: googleExpiresAt,
    };

    yield* Effect.logInfo('AuthData').pipe(Effect.annotateLogs({ authData }));
    yield* Effect.logInfo('Generated auth_code').pipe(Effect.annotateLogs({ authCode }));

    // Step 5: Store PKCE state and auth_code in Redis (sequential)
    yield* redisOps.setAuthCodeState(authCode, pkceData);
    yield* redisOps.setAuthCode(authCode, authData, 300);

    // Step 6: Delete PKCE session (cleanup) - catch errors to not fail the flow
    yield* Effect.catchAll(redisOps.deletePKCEState(flowId), (err) =>
      Effect.logError('Failed to delete PKCE session').pipe(Effect.annotateLogs({ err, flowId })),
    );

    // Step 7: Build redirect URL
    const ptCallback = new URL(pkceData.redirect_uri);
    ptCallback.searchParams.set('code', authCode);
    ptCallback.searchParams.set('state', pkceData.state);

    yield* Effect.logInfo('Callback complete, redirecting').pipe(
      Effect.annotateLogs({
        redirectUri: ptCallback.toString(),
      }),
    );

    return ptCallback.toString();
  });
