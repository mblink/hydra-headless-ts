import { Effect, Layer } from 'effect'
import { describe, it, expect, vi } from 'vitest'
import { InvalidState } from '../errors.js'
import { processConsent } from './consent.js'
import { HydraService } from './hydra.js'

const config = {
  googleClientId: 'google-client-id',
  middlewareRedirectUri: 'https://auth.example.com/callback',
}

const setup = (requestUrl: string | undefined) => {
  const acceptConsentRequest = vi.fn(() =>
    Effect.succeed({ redirect_to: 'https://auth.example.com/oauth2/auth?consent_verifier=x' })
  )
  const hydra = {
    getConsentRequest: vi.fn(() =>
      Effect.succeed({
        challenge: 'consent-challenge',
        subject: 'claude@claude.ai',
        requested_scope: ['openid', 'email'],
        requested_access_token_audience: [],
        request_url: requestUrl,
      })
    ),
    acceptConsentRequest,
  } as unknown as HydraService
  const run = () =>
    Effect.runPromise(
      Effect.either(
        Effect.provide(
          processConsent('consent-challenge', config),
          Layer.succeed(HydraService, hydra)
        )
      )
    )
  return { run, acceptConsentRequest }
}

describe('processConsent', () => {
  it('sends the flow id from Hydra’s request_url to Google as state', async () => {
    const { run } = setup(
      'https://auth.example.com/oauth2/auth?client_id=client-1&response_type=code&state=flow-123'
    )

    const result = await run()

    expect(result._tag).toBe('Right')
    if (result._tag !== 'Right') return
    const google = new URL(result.right)
    expect(google.origin).toBe('https://accounts.google.com')
    expect(google.searchParams.get('state')).toBe('flow-123')
    expect(google.searchParams.get('client_id')).toBe('google-client-id')
    expect(google.searchParams.get('redirect_uri')).toBe(config.middlewareRedirectUri)
  })

  it.each([
    ['no request_url', undefined],
    ['no state in request_url', 'https://auth.example.com/oauth2/auth?client_id=client-1'],
  ])('fails without accepting consent when there is %s', async (_, requestUrl) => {
    const { run, acceptConsentRequest } = setup(requestUrl)

    const result = await run()

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(InvalidState)
    }
    expect(acceptConsentRequest).not.toHaveBeenCalled()
  })
})
