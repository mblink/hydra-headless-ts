/**
 * Functional login route using Effect
 */
import { Effect, pipe } from 'effect';
import express from 'express';
import { type AppError } from '../fp/errors.js';
import { processLogin } from '../fp/services/login.js';
import type { HydraService } from '../fp/services/hydra.js';
import type { Layer } from 'effect';

const router = express.Router();
const SUBJECT_PLACEHOLDER = 'claude@claude.ai';

/**
 * Map application errors to HTTP responses
 */
const mapErrorToHttp = (error: AppError): { status: number; message: string } => {
  switch (error._tag) {
    case 'HttpStatusError':
      return { status: error.status, message: error.statusText };
    case 'NetworkError':
      return { status: 500, message: 'Network error communicating with Hydra' };
    default:
      return { status: 500, message: 'Internal server error' };
  }
};

/**
 * Login handler factory
 */
const createLoginHandler = (serviceLayer: Layer.Layer<HydraService>) => {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const challenge = String(req.query.login_challenge ?? req.body.challenge);

    // Log entry point
    await Effect.runPromise(
      Effect.logInfo('=== LOGIN ENDPOINT CALLED ===').pipe(
        Effect.annotateLogs({
          method: req.method,
          path: req.path,
          has_login_challenge: !!challenge,
          login_challenge_preview: challenge ? `${challenge.substring(0, 20)}...` : 'none',
          query: req.query,
          body: req.body,
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
        Effect.provide(serviceLayer),
      ),
    );

    if (!challenge) {
      await Effect.runPromise(
        Effect.logError('=== LOGIN ERROR: Missing Challenge ===').pipe(
          Effect.annotateLogs({
            query: req.query,
            body: req.body,
            timestamp: new Date().toISOString(),
          }),
          Effect.provide(serviceLayer),
        ),
      );
      next(new Error('Expected a login challenge to be set but received none.'));
      return;
    }

    const program = pipe(
      Effect.logInfo('Processing login request').pipe(
        Effect.annotateLogs({
          challenge_preview: `${challenge.substring(0, 20)}...`,
          subject: SUBJECT_PLACEHOLDER,
        }),
      ),
      Effect.andThen(() => processLogin(challenge, SUBJECT_PLACEHOLDER)),
      Effect.provide(serviceLayer),
    );

    const result = await Effect.runPromise(Effect.either(program));

    if (result._tag === 'Left') {
      const { status, message } = mapErrorToHttp(result.left);

      await Effect.runPromise(
        Effect.logError('=== LOGIN ERROR ===').pipe(
          Effect.annotateLogs({
            error_tag: result.left._tag,
            error_details: result.left,
            status,
            message,
            challenge_preview: `${challenge.substring(0, 20)}...`,
            timestamp: new Date().toISOString(),
          }),
          Effect.provide(serviceLayer),
        ),
      );

      res.status(status).send(message);
    } else {
      await Effect.runPromise(
        Effect.logInfo('=== LOGIN SUCCESS ===').pipe(
          Effect.annotateLogs({
            redirect_to: result.right,
            challenge_preview: `${challenge.substring(0, 20)}...`,
            timestamp: new Date().toISOString(),
          }),
          Effect.provide(serviceLayer),
        ),
      );

      res.redirect(result.right);
    }
  };
};

/**
 * Create login router with service layer
 */
export const createLoginRouter = (serviceLayer: Layer.Layer<HydraService>) => {
  const handler = createLoginHandler(serviceLayer);

  router.get('/', handler);
  router.post('/', handler);

  return router;
};

export default router;
