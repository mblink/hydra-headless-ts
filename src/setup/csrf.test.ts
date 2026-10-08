import type { AddressInfo } from 'node:net'
import cookieParser from 'cookie-parser'
import express from 'express'
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
    // Mirror app-fp.ts middleware order
    app.use(express.urlencoded({ extended: false }))
    app.use(cookieParser(appConfig.security.cookieSecret))
    app.use((req, _res, next) => {
      ;(req as unknown as { session: object }).session = { id: 'session-1' }
      next()
    })
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

  const getForm = async () => {
    const res = await fetch(`${baseUrl}/form`)
    if (!res.ok) throw new Error(`GET /form ${res.status}: ${await res.text()}`)
    const { field, token } = (await res.json()) as { field: string; token: string }
    return { field, token, setCookie: res.headers.get('set-cookie') ?? '' }
  }

  it('sets an HttpOnly CSRF cookie with a valid SameSite/Secure combination', async () => {
    const { setCookie } = await getForm()

    expect(setCookie).toMatch(/HttpOnly/i)
    // Browsers reject SameSite=None cookies that are not Secure
    if (/SameSite=None/i.test(setCookie)) {
      expect(setCookie).toMatch(/;\s*Secure/i)
    }
  })

  it('accepts a form POST carrying the token in the hidden field', async () => {
    const { field, token, setCookie } = await getForm()

    const res = await fetch(`${baseUrl}/form`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: setCookie.split(';')[0],
      },
      body: new URLSearchParams({ [field]: token }),
    })

    expect(await res.text()).toBe('ok')
  })

  it('rejects a form POST with a missing or wrong token', async () => {
    const { field, setCookie } = await getForm()

    const missing = await fetch(`${baseUrl}/form`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: setCookie.split(';')[0],
      },
      body: '',
    })
    const wrong = await fetch(`${baseUrl}/form`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: setCookie.split(';')[0],
      },
      body: new URLSearchParams({ [field]: 'not-a-token' }),
    })

    expect(missing.status).toBe(403)
    expect(wrong.status).toBe(403)
  })
})
