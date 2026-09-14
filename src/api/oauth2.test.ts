import { Effect } from 'effect'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeOAuth2ApiService } from './oauth2.js'

/**
 * CIMD client_ids are https:// URLs (e.g.
 * "https://claude.ai/oauth/mcp-oauth-client-metadata"), unlike Hydra's own
 * opaque DCR ids. Every admin API call that puts a client id in the path
 * must percent-encode it — otherwise the extra "://" and "/" characters
 * produce a path with more segments than Hydra's router expects for
 * `/admin/clients/:id`, and the request 404s regardless of whether the
 * client exists. That false 404 is what let a stale/duplicate
 * `createClient` retry slip through in upsertCimdClient (see authFlow.ts).
 */
describe('makeOAuth2ApiService client id encoding', () => {
  const cimdClientId = 'https://claude.ai/oauth/mcp-oauth-client-metadata'

  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '{}',
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  const service = makeOAuth2ApiService({ basePath: 'http://admin.internal:4445' })

  const requestedUrl = (): string => {
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    return url
  }

  it('percent-encodes the id in getClient', async () => {
    await Effect.runPromise(service.getClient(cimdClientId))
    expect(requestedUrl()).toBe(
      'http://admin.internal:4445/admin/clients/https%3A%2F%2Fclaude.ai%2Foauth%2Fmcp-oauth-client-metadata'
    )
  })

  it('percent-encodes the id in updateClient', async () => {
    await Effect.runPromise(service.updateClient(cimdClientId, { client_id: cimdClientId }))
    expect(requestedUrl()).toBe(
      'http://admin.internal:4445/admin/clients/https%3A%2F%2Fclaude.ai%2Foauth%2Fmcp-oauth-client-metadata'
    )
  })

  it('percent-encodes the id in patchClient', async () => {
    await Effect.runPromise(service.patchClient(cimdClientId, []))
    expect(requestedUrl()).toBe(
      'http://admin.internal:4445/admin/clients/https%3A%2F%2Fclaude.ai%2Foauth%2Fmcp-oauth-client-metadata'
    )
  })

  it('percent-encodes the id in deleteClient', async () => {
    await Effect.runPromise(service.deleteClient(cimdClientId))
    expect(requestedUrl()).toBe(
      'http://admin.internal:4445/admin/clients/https%3A%2F%2Fclaude.ai%2Foauth%2Fmcp-oauth-client-metadata'
    )
  })

  it('percent-encodes the id in setClientLifespans', async () => {
    await Effect.runPromise(service.setClientLifespans(cimdClientId, {}))
    expect(requestedUrl()).toBe(
      'http://admin.internal:4445/admin/clients/https%3A%2F%2Fclaude.ai%2Foauth%2Fmcp-oauth-client-metadata/lifespans'
    )
  })

  it('leaves a plain DCR (uuid-shaped) id unchanged', async () => {
    await Effect.runPromise(service.getClient('a1b2c3d4-e5f6-7890-abcd-ef1234567890'))
    expect(requestedUrl()).toBe(
      'http://admin.internal:4445/admin/clients/a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    )
  })
})
