/**
 * Login flow business logic using Effect
 */
import { Effect } from 'effect';
import { type AppError } from '../errors.js';
import { HydraService } from './hydra.js';

/**
 * Process login request
 * Auto-accepts login with provided subject
 */
export const processLogin = (challenge: string, subject: string): Effect.Effect<string, AppError, HydraService> =>
  Effect.gen(function* () {
    // Access services
    const hydra = yield* HydraService;

    yield* Effect.logInfo('Processing login challenge').pipe(Effect.annotateLogs({ challenge, subject }));

    // Get login request details
    const loginRequest = yield* hydra.getLoginRequest(challenge);

    yield* Effect.logInfo('Login request received').pipe(
      Effect.annotateLogs({
        clientId: loginRequest.client?.client_id,
      }),
    );

    // Accept login request
    const redirectTo = yield* hydra.acceptLoginRequest(challenge, {
      subject,
      remember: true,
      remember_for: 3600,
      acr: '0', // Authentication Context Class Reference
    });

    yield* Effect.logInfo('Login accepted, redirecting to').pipe(
      Effect.annotateLogs({
        redirect_to: redirectTo.redirect_to,
      }),
    );

    return String(redirectTo.redirect_to);
  });
