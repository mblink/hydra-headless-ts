/**
 * Functional index route using Effect
 *
 * Health check endpoints for monitoring and testing.
 * These are not part of the OAuth2 flow and don't require CSRF protection.
 */
import { Effect, pipe } from 'effect'
import express from 'express'
import type { Layer } from 'effect'

const router = express.Router()

/**
 * HEAD / - Health check endpoint (headers only)
 */
const createHeadHandler = (serviceLayer: Layer.Layer<never>) => {
  return async (req: express.Request, res: express.Response) => {
    const program = pipe(
      Effect.gen(function* () {
        yield* Effect.logInfo('HEAD / request received').pipe(
          Effect.annotateLogs({ headers: req.headers })
        )

        return 'No Change'
      }),
      Effect.provide(serviceLayer)
    )

    await Effect.runPromise(Effect.either(program))

    res.set('X-Hydra-Headless-Special', 'Head-Only-Value')
    res.status(200).end()
  }
}

/**
 * GET / - Health check endpoint
 */
const createGetHandler = (serviceLayer: Layer.Layer<never>) => {
  return async (req: express.Request, res: express.Response) => {
    const program = pipe(
      Effect.gen(function* () {
        yield* Effect.logInfo('GET / request received').pipe(
          Effect.annotateLogs({ headers: req.headers })
        )

        return 'No Change'
      }),
      Effect.provide(serviceLayer)
    )

    await Effect.runPromise(Effect.either(program))

    res.set('X-Hydra-Headless-Special', 'Head-Only-Value')
    res.status(200).end()
  }
}

/**
 * POST / - Health check endpoint (for testing)
 */
const createPostHandler = (serviceLayer: Layer.Layer<never>) => {
  return async (req: express.Request, res: express.Response) => {
    const program = pipe(
      Effect.gen(function* () {
        yield* Effect.logInfo('POST / request received').pipe(
          Effect.annotateLogs({ headers: req.headers })
        )

        return 'No Change'
      }),
      Effect.provide(serviceLayer)
    )

    await Effect.runPromise(Effect.either(program))

    res.set('X-Hydra-Headless-Special', 'Head-Only-Value')
    res.status(200).end()
  }
}

/**
 * Create index router with service layer
 */
export const createIndexRouter = (serviceLayer: Layer.Layer<never>) => {
  router.head('/', createHeadHandler(serviceLayer))
  router.get('/', createGetHandler(serviceLayer))
  router.post('/', createPostHandler(serviceLayer))
  return router
}
