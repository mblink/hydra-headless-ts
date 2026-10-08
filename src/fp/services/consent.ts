/**
 * Consent flow business logic using Effect
 */
import { Effect } from 'effect'
import { PKCEStateSchema } from '../domain.js'
import { type AppError } from '../errors.js'
import { HydraService } from './hydra.js'
import { RedisService, createOAuthRedisOps } from './redis.js'

/**
 * Configuration for Google OAuth
 */
export interface ConsentConfig {
  readonly googleClientId: string
  readonly middlewareRedirectUri: string
}

/**
 * Build Google OAuth URL
 */
const buildGoogleAuthUrl = (config: ConsentConfig, state: string): string => {
  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  googleAuthUrl.searchParams.set('client_id', config.googleClientId)
  googleAuthUrl.searchParams.set('redirect_uri', config.middlewareRedirectUri)
  googleAuthUrl.searchParams.set('response_type', 'code')
  googleAuthUrl.searchParams.set('scope', 'openid profile email')
  googleAuthUrl.searchParams.set('state', state)
  googleAuthUrl.searchParams.set('access_type', 'offline')
  googleAuthUrl.searchParams.set('prompt', 'consent')
  return googleAuthUrl.toString()
}

/**
 * Process consent request
 * 1. Get consent info from Hydra
 * 2. Accept consent
 * 3. Build and return Google OAuth URL
 */
export const processConsent = (
  challenge: string,
  config: ConsentConfig,
  requestedScope?: string
): Effect.Effect<string, AppError, HydraService> =>
  Effect.gen(function* () {
    // Access services
    const hydra = yield* HydraService

    yield* Effect.logInfo('Processing consent challenge').pipe(Effect.annotateLogs({ challenge }))

    // Step 1: Get consent info
    const consentInfo = yield* hydra.getConsentRequest(challenge)

    yield* Effect.logInfo('Consent info received').pipe(
      Effect.annotateLogs({
        subject: consentInfo.subject,
        requestedScopes: consentInfo.requested_scope,
      })
    )

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
    })

    // Step 3: Build Google OAuth URL
    const googleUrl = buildGoogleAuthUrl(config, challenge)

    yield* Effect.logInfo('Redirecting to Google OAuth').pipe(
      Effect.annotateLogs({ url: googleUrl })
    )

    return googleUrl
  })

/**
 * Process consent with PKCE from session
 * This version fetches PKCE state from Redis first
 */
export const processConsentWithPKCE = (
  challenge: string,
  sessionId: string,
  config: ConsentConfig,
  requestedScope?: string
): Effect.Effect<string, AppError, HydraService | RedisService> =>
  Effect.gen(function* () {
    // Access services
    const redis = yield* RedisService

    const redisOps = createOAuthRedisOps(redis)

    // Fetch PKCE from Redis
    const pkceData = yield* redisOps.getPKCEState(sessionId, PKCEStateSchema)

    // Continue with consent flow
    const baseUrl = yield* processConsent(challenge, config, requestedScope)

    // Use actual state from PKCE
    const url = new URL(baseUrl)
    url.searchParams.set('state', pkceData.state || challenge)

    yield* Effect.logInfo('Using PKCE state from session').pipe(
      Effect.annotateLogs({ sessionId, state: pkceData.state })
    )

    return url.toString()
  })
