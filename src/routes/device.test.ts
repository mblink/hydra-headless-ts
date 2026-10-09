import type { AddressInfo } from 'node:net'
import cookieParser from 'cookie-parser'
import { Effect, Layer } from 'effect'
import express from 'express'
import session from 'express-session'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { OAuth2ApiService } from '../api/oauth2.js'
import type { Server } from 'node:http'

describe('routes/device (RFC 8628 user code verification)', () => {
  let server: Server
  let baseUrl: string
  const acceptUserCodeRequest = vi.fn()
  const originalEnv = { ...process.env }

  beforeAll(async () => {
    process.env = { ...originalEnv, APP_ENV: 'local', BASE_URL: 'http://localhost:3000' }
    delete process.env.COOKIE_SECRET
    const { appConfig } = await import('../config.js')
    const { createDeviceRouter } = await import('./device.js')

    const oauth2Layer = Layer.succeed(OAuth2ApiService, {
      acceptUserCodeRequest,
    } as unknown as OAuth2ApiService)

    // Mirror app-fp.ts middleware order
    const app = express()
    app.use(express.urlencoded({ extended: false }))
    app.use(session({ secret: 'test-session-secret', resave: false, saveUninitialized: false }))
    app.use(cookieParser(appConfig.security.cookieSecret))
    app.use('/device', createDeviceRouter(oauth2Layer))
    app.use(
      (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(err.message.includes('csrf') ? 403 : 500).send(err.message)
      }
    )

    server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    process.env = originalEnv
    await new Promise((resolve) => server.close(resolve))
  })

  beforeEach(() => {
    acceptUserCodeRequest.mockReset()
    acceptUserCodeRequest.mockReturnValue(
      Effect.succeed({ redirect_to: 'https://hydra.example.com/oauth2/device/verify?next=1' })
    )
  })

  // Load the form and collect every <input name=... value=...> like a browser would submit it
  const loadForm = async (query: string) => {
    const res = await fetch(`${baseUrl}/device/verify${query}`)
    const html = await res.text()
    const fields = Object.fromEntries(
      [...html.matchAll(/<input\b[^>]*>/g)]
        .map(([tag]) => [/name="([^"]*)"/.exec(tag)?.[1], /value="([^"]*)"/.exec(tag)?.[1] ?? ''])
        .filter((entry): entry is [string, string] => entry[0] !== undefined)
    )
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    return { status: res.status, fields, cookie }
  }

  it('submits the rendered form to Hydra with the device challenge and user code', async () => {
    const { status, fields, cookie } = await loadForm('?device_challenge=challenge-123')
    expect(status).toBe(200)

    // The user types the code shown on their device
    const res = await fetch(`${baseUrl}/device/verify`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ ...fields, user_code: 'ABCD-EFGH' }),
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'https://hydra.example.com/oauth2/device/verify?next=1'
    )
    expect(acceptUserCodeRequest).toHaveBeenCalledWith('challenge-123', { user_code: 'ABCD-EFGH' })
  })

  it('pre-fills the user code from the query string', async () => {
    const { fields } = await loadForm('?device_challenge=challenge-123&user_code=WXYZ-1234')

    expect(fields.user_code).toBe('WXYZ-1234')
  })

  it('rejects a request without a device challenge', async () => {
    const { status } = await loadForm('')

    expect(status).toBe(500)
    expect(acceptUserCodeRequest).not.toHaveBeenCalled()
  })

  it('returns 400 when the user code is missing', async () => {
    const { fields, cookie } = await loadForm('?device_challenge=challenge-123')

    const res = await fetch(`${baseUrl}/device/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ ...fields, user_code: '' }),
    })

    expect(res.status).toBe(400)
    expect(acceptUserCodeRequest).not.toHaveBeenCalled()
  })
})
