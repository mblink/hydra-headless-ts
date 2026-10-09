/**
 * Consent flow business logic using Effect
 */
import { Effect } from 'effect';
import { type AppError, InvalidState } from '../errors.js';
import { HydraService } from './hydra.js';

/**
 * Configuration for Google OAuth
 */
export interface ConsentConfig {
  readonly googleClientId: string;
  readonly middlewareRedirectUri: string;
}

/**
 * Build Google OAuth URL
 */
const buildGoogleAuthUrl = (config: ConsentConfig, state: string): string => {
  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', config.googleClientId);
  googleAuthUrl.searchParams.set('redirect_uri', config.middlewareRedirectUri);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'openid profile email');
  googleAuthUrl.searchParams.set('state', state);
  googleAuthUrl.searchParams.set('access_type', 'offline');
  googleAuthUrl.searchParams.set('prompt', 'consent');
  return googleAuthUrl.toString();
};

/**
 * The flow id the /oauth2/auth proxy put in `state` (see setup/proxy.ts). Hydra keeps the
 * authorization URL it received as the consent request's request_url.
 */
const flowIdFromRequestUrl = (requestUrl: string | undefined): string | undefined => {
  if (!requestUrl) return undefined;
  try {
    return new URL(requestUrl, 'http://localhost').searchParams.get('state') ?? undefined;
  } catch {
    return undefined;
  }
};

/**
 * Process consent request
 * 1. Get consent info from Hydra
 * 2. Accept consent
 * 3. Build and return Google OAuth URL, with the flow id as `state`
 */
export const processConsent = (
  challenge: string,
  config: ConsentConfig,
  requestedScope?: string,
): Effect.Effect<string, AppError, HydraService> =>
  Effect.gen(function* () {
    // Access services
    const hydra = yield* HydraService;

    yield* Effect.logInfo('Processing consent challenge').pipe(Effect.annotateLogs({ challenge }));

    // Step 1: Get consent info
    const consentInfo = yield* hydra.getConsentRequest(challenge);

    yield* Effect.logInfo('Consent info received').pipe(
      Effect.annotateLogs({
        subject: consentInfo.subject,
        requestedScopes: consentInfo.requested_scope,
      }),
    );

    const flowId = flowIdFromRequestUrl(consentInfo.request_url);
    if (!flowId) {
      return yield* Effect.fail(new InvalidState({ reason: 'Consent request is not linked to an /oauth2/auth flow' }));
    }

    // Step 2: Accept consent with requested scopes
    yield* hydra.acceptConsentRequest(challenge, {
      grant_scope: requestedScope ? [requestedScope] : consentInfo.requested_scope,
      grant_access_token_audience: consentInfo.requested_access_token_audience,
      session: {
        id_token: {},
        access_token: {},
      },
      remember: true,
      remember_for: 3600,
    });

    // Step 3: Build Google OAuth URL
    const googleUrl = buildGoogleAuthUrl(config, flowId);

    yield* Effect.logInfo('Redirecting to Google OAuth').pipe(Effect.annotateLogs({ url: googleUrl }));

    return googleUrl;
  });
