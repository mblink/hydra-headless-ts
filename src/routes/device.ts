/**
 * OAuth2 Device Authorization Flow (RFC 8628)
 *
 * Handles device code verification with CSRF protection.
 */
import url from 'url'
import { Effect, pipe } from 'effect'
import express from 'express'
import { OAuth2ApiService } from '../api/oauth2.js'
import { appConfig } from '../config.js'
import { type AppError } from '../fp/errors.js'
import { doubleCsrfProtection, generateCsrfToken } from '../setup/index.js'
import { DeviceVerify, DeviceSuccess } from '../views/index.js'
import type { Layer } from 'effect'

const router = express.Router()

const mapErrorToHttp = (error: AppError): { status: number; message: string } => {
  switch (error._tag) {
    case 'HttpStatusError':
      return { status: error.status, message: error.statusText }
    case 'NetworkError':
      return { status: 500, message: 'Network error communicating with Hydra' }
    default:
      return { status: 500, message: 'Internal server error' }
  }
}

/**
 * GET /verify - Render device verification form
 * This doesn't need Effect since it's just rendering a form
 */
router.get('/verify', (req, res, next) => {
  const query = url.parse(req.url, true).query

  // The challenge is used to fetch information about the device request from ORY Hydra
  const challenge = String(query.device_challenge)
  if (!challenge) {
    next(new Error('Expected a device challenge to be set but received none.'))
    return
  }

  // Generate CSRF token for the device verification form
  const csrfToken = generateCsrfToken(req, res)

  res.send(
    DeviceVerify({
      action: '/device/verify',
      csrfToken,
      envXsrfToken: appConfig.security.xsrfHeaderName,
      challenge,
      userCode: String(query.user_code ?? ''),
    })
  )
})

/**
 * POST /verify handler factory
 */
const createVerifyHandler = (serviceLayer: Layer.Layer<OAuth2ApiService>) => {
  return async (req: express.Request, res: express.Response) => {
    const { code: userCode, challenge } = req.body

    if (!challenge || !userCode) {
      res.status(400).send('Missing challenge or user_code')
      return
    }

    const program = pipe(
      Effect.gen(function* () {
        const oauth2Api = yield* OAuth2ApiService
        const redirectTo = yield* oauth2Api.acceptUserCodeRequest(challenge, {
          user_code: userCode,
        })

        return redirectTo.redirect_to || ''
      }),
      Effect.provide(serviceLayer)
    )

    const result = await Effect.runPromise(Effect.either(program))

    if (result._tag === 'Left') {
      const { status, message } = mapErrorToHttp(result.left)
      res.status(status).send(message)
    } else {
      res.redirect(result.right)
    }
  }
}

/**
 * GET /success - Render success page
 * This doesn't need Effect since it's just rendering a page
 */
router.get('/success', (_req, res) => {
  res.send(DeviceSuccess({}))
})

export const createDeviceRouter = (serviceLayer: Layer.Layer<OAuth2ApiService>) => {
  // Apply CSRF protection to POST route (form submission)
  router.post('/verify', doubleCsrfProtection, createVerifyHandler(serviceLayer))
  return router
}

export default router
