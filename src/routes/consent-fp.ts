/**
 * Functional consent route using Effect
 */
import { Effect, pipe } from 'effect'
import express from 'express'
import { type AppError } from '../fp/errors.js'
import { processConsent, type ConsentConfig } from '../fp/services/consent.js'
import { ErrorPage } from '../views/index.js'
import type { HydraService } from '../fp/services/hydra.js'
import type { Layer } from 'effect'

const router = express.Router()

/**
 * Map application errors to HTTP responses
 */
const mapErrorToHttp = (error: AppError): { status: number; message: string } => {
  switch (error._tag) {
    case 'HttpStatusError':
      return { status: error.status, message: error.statusText }
    case 'NetworkError':
      return { status: 500, message: 'Network error communicating with Hydra' }
    case 'InvalidState':
      return { status: 400, message: 'Authorization request not found or expired' }
    default:
      return { status: 500, message: 'Internal server error' }
  }
}

/**
 * Consent handler
 */
const createConsentHandler = (serviceLayer: Layer.Layer<HydraService>, config: ConsentConfig) => {
  return async (req: express.Request, res: express.Response) => {
    const challenge = String(req.query.consent_challenge)
    const requestedScope = req.query.requested_scope as string | undefined

    // Log entry point
    await Effect.runPromise(
      Effect.logInfo('=== CONSENT ENDPOINT CALLED ===').pipe(
        Effect.annotateLogs({
          method: req.method,
          path: req.path,
          has_consent_challenge: !!challenge,
          consent_challenge_preview: challenge ? `${challenge.substring(0, 20)}...` : 'none',
          requested_scope: requestedScope,
          query: req.query,
          session_id: req.session?.id,
          headers: {
            'content-type': req.headers['content-type'],
            'user-agent': req.headers['user-agent'],
            origin: req.headers.origin,
            referer: req.headers.referer,
          },
          ip: req.ip,
          timestamp: new Date().toISOString(),
        }),
        Effect.provide(serviceLayer)
      )
    )

    if (!challenge) {
      await Effect.runPromise(
        Effect.logError('=== CONSENT ERROR: Missing Challenge ===').pipe(
          Effect.annotateLogs({
            query: req.query,
            timestamp: new Date().toISOString(),
          }),
          Effect.provide(serviceLayer)
        )
      )
      res.status(400).send('Missing consent_challenge parameter')
      return
    }

    const program = pipe(
      Effect.logInfo('Processing consent request').pipe(
        Effect.annotateLogs({
          challenge_preview: `${challenge.substring(0, 20)}...`,
          requested_scope: requestedScope,
          config,
        })
      ),
      Effect.andThen(() => processConsent(challenge, config, requestedScope)),
      Effect.provide(serviceLayer)
    )

    const result = await Effect.runPromise(Effect.either(program))

    if (result._tag === 'Left') {
      const { status, message } = mapErrorToHttp(result.left)

      await Effect.runPromise(
        Effect.logError('=== CONSENT ERROR ===').pipe(
          Effect.annotateLogs({
            error_tag: result.left._tag,
            error_details: result.left,
            status,
            message,
            challenge_preview: `${challenge.substring(0, 20)}...`,
            timestamp: new Date().toISOString(),
          }),
          Effect.provide(serviceLayer)
        )
      )

      res.status(status).send(ErrorPage({ message }))
    } else {
      await Effect.runPromise(
        Effect.logInfo('=== CONSENT SUCCESS ===').pipe(
          Effect.annotateLogs({
            redirect_to: result.right,
            challenge_preview: `${challenge.substring(0, 20)}...`,
            timestamp: new Date().toISOString(),
          }),
          Effect.provide(serviceLayer)
        )
      )

      res.redirect(result.right)
    }
  }
}

/**
 * Create consent router with service layer
 */
export const createConsentRouter = (
  serviceLayer: Layer.Layer<HydraService>,
  config: ConsentConfig
) => {
  router.get('/', createConsentHandler(serviceLayer, config))
  return router
}

export default router
