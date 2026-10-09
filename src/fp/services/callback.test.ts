import { Effect, Layer } from 'effect'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GoogleAuthError, RedisKeyNotFound } from '../errors.js'
import { processCallback, type GoogleOAuthClient } from './callback.js'
import { RedisService, makeRedisService } from './redis.js'
import type { Redis } from 'ioredis'

const createMemoryRedis = () => {
  const store = new Map<string, string>()
  const client = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
    del: vi.fn(async (...keys: string[]) => keys.filter((k) => store.delete(k)).length),
    exists: vi.fn(async (...keys: string[]) => keys.filter((k) => store.has(k)).length),
  } as unknown as Redis
  return { store, client }
}

const pkceState = {
  code_challenge: 'challenge',
  code_challenge_method: 'S256',
  scope: 'openid email',
  state: 'client-state',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  client_id: 'client-1',
  timestamp: Date.now(),
}

const config = { middlewareRedirectUri: 'https://auth.example.com/callback' }

describe('processCallback', () => {
  let store: Map<string, string>
  let layer: Layer.Layer<RedisService>

  beforeEach(() => {
    const mem = createMemoryRedis()
    store = mem.store
    layer = Layer.succeed(RedisService, makeRedisService(mem.client))
    store.set('pkce_session:pkce-1', JSON.stringify(pkceState))
  })

  const run = (googleClient: GoogleOAuthClient) =>
    Effect.runPromise(
      Effect.either(
        Effect.provide(
          processCallback('google-code', 'session-1', 'pkce-1', googleClient, config),
          layer
        )
      )
    )

  it('stores Google tokens under a new auth code and redirects to the client', async () => {
    const googleExpiresAt = Date.now() + 1799 * 1000
    // Shape returned by google-auth-library's getToken(): expiry_date instead of expires_in
    const googleClient: GoogleOAuthClient = {
      getToken: vi.fn(async () => ({
        tokens: {
          access_token: 'g-access',
          refresh_token: 'g-refresh',
          id_token: 'g-id',
          scope: 'openid email',
          token_type: 'Bearer',
          expiry_date: googleExpiresAt,
        },
      })),
    }

    const result = await run(googleClient)

    expect(result._tag).toBe('Right')
    if (result._tag !== 'Right') return
    const redirect = new URL(result.right)
    expect(`${redirect.origin}${redirect.pathname}`).toBe(pkceState.redirect_uri)
    expect(redirect.searchParams.get('state')).toBe('client-state')

    const code = redirect.searchParams.get('code')!
    const authData = JSON.parse(store.get(`auth_code:${code}`)!)
    expect(authData.google_tokens.tokens).toMatchObject({
      access_token: 'g-access',
      refresh_token: 'g-refresh',
      id_token: 'g-id',
      scope: 'openid email',
    })
    // Uses Google's real lifetime rather than a hardcoded 3600
    expect(authData.google_tokens.tokens.expires_in).toBeGreaterThanOrEqual(1798)
    expect(authData.google_tokens.tokens.expires_in).toBeLessThanOrEqual(1799)
    // The absolute expiry is stored so the exchange can measure the remaining lifetime
    expect(authData.google_expires_at).toBe(googleExpiresAt)

    expect(JSON.parse(store.get(`auth_code_state:${code}`)!)).toEqual(pkceState)
    expect(store.has('pkce_session:pkce-1')).toBe(false)
  })

  it('fails when Google returns no access token', async () => {
    const result = await run({ getToken: vi.fn(async () => ({ tokens: {} })) })

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(GoogleAuthError)
    }
  })

  it('fails when the code exchange throws', async () => {
    const result = await run({
      getToken: vi.fn(async () => {
        throw new Error('invalid_grant')
      }),
    })

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(GoogleAuthError)
    }
  })

  it('fails when the PKCE session is missing', async () => {
    store.clear()

    const result = await run({ getToken: vi.fn() })

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(RedisKeyNotFound)
    }
  })
})
