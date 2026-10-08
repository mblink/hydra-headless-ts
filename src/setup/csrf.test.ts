import type { AddressInfo } from 'node:net'
import cookieParser from 'cookie-parser'
import express from 'express'
import session from 'express-session'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Server } from 'node:http'

describe('setup/index CSRF protection', () => {
  let server: Server
  let baseUrl: string
  const originalEnv = { ...process.env }

  beforeAll(async () => {
    process.env = { ...originalEnv, APP_ENV: 'local', BASE_URL: 'http://localhost:3000' }
    delete process.env.COOKIE_SECRET
    const { appConfig } = await import('../config.js')
    const { doubleCsrfProtection, generateCsrfToken } = await import('./index.js')

    const app = express()
    // Mirror app-fp.ts: real sessions with saveUninitialized: false (MemoryStore instead of Postgres)
    app.use(express.urlencoded({ extended: false }))
    app.use(
      session({
        secret: 'test-session-secret',
        resave: false,
        saveUninitialized: false,
      })
    )
    app.use(cookieParser(appConfig.security.cookieSecret))
    // Same shape as the logout and device/verify forms: token in a hidden field
    app.get('/form', (req, res) => {
      res.json({ field: appConfig.security.xsrfHeaderName, token: generateCsrfToken(req, res) })
    })
    app.post('/form', doubleCsrfProtection, (_req, res) => {
      res.send('ok')
    })
    app.use(
      (
        err: Error & { code?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => {
        res.status(403).send(`${err.code ?? ''} ${err.message}`)
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

  // Fresh visitor: no cookies yet. Returns the cookies a browser would send back on the POST.
  const getForm = async () => {
    const res = await fetch(`${baseUrl}/form`)
    if (!res.ok) throw new Error(`GET /form ${res.status}: ${await res.text()}`)
    const { field, token } = (await res.json()) as { field: string; token: string }
    const setCookies = res.headers.getSetCookie()
    const cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
    return { field, token, setCookies, cookie }
  }

  const postForm = (cookie: string, body: string | URLSearchParams, headers = {}) =>
    fetch(`${baseUrl}/form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, ...headers },
      body,
    })

  it('sets an HttpOnly CSRF cookie with a valid SameSite/Secure combination', async () => {
    const { setCookies } = await getForm()
    const csrfCookie = setCookies.find((c) => !c.startsWith('connect.sid=')) ?? ''

    expect(csrfCookie).toMatch(/HttpOnly/i)
    // Browsers reject SameSite=None cookies that are not Secure
    if (/SameSite=None/i.test(csrfCookie)) {
      expect(csrfCookie).toMatch(/;\s*Secure/i)
    }
  })

  it('persists the session so the POST is validated against the same session id', async () => {
    const { setCookies } = await getForm()

    expect(setCookies.some((c) => c.startsWith('connect.sid='))).toBe(true)
  })

  it('accepts a form POST from a fresh visitor carrying the token in the hidden field', async () => {
    const { field, token, cookie } = await getForm()

    const res = await postForm(cookie, new URLSearchParams({ [field]: token }))

    expect(await res.text()).toBe('ok')
  })

  it('accepts the token in the x-csrf-token header', async () => {
    const { token, cookie } = await getForm()

    const res = await postForm(cookie, '', { 'x-csrf-token': token })

    expect(await res.text()).toBe('ok')
  })

  it('rejects a form POST with a missing or wrong token', async () => {
    const { field, cookie } = await getForm()

    const missing = await postForm(cookie, '')
    const wrong = await postForm(cookie, new URLSearchParams({ [field]: 'not-a-token' }))

    expect(missing.status).toBe(403)
    expect(wrong.status).toBe(403)
  })

  it('rejects a repeated x-csrf-token header cleanly', async () => {
    const { token, cookie } = await getForm()
    const headers = new Headers({
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
    })
    headers.append('x-csrf-token', token)
    headers.append('x-csrf-token', token)

    const res = await fetch(`${baseUrl}/form`, { method: 'POST', headers, body: '' })

    expect(res.status).toBe(403)
  })
})
