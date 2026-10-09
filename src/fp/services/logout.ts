/**
 * Logout flow business logic using Effect
 */
import { Effect } from 'effect';
import { type AppError } from '../errors.js';
import { HydraService } from './hydra.js';

/**
 * Get logout request information
 * Returns challenge and subject for rendering confirmation form
 */
export const getLogoutInfo = (
  challenge: string,
): Effect.Effect<{ challenge: string; subject?: string }, AppError, HydraService> =>
  Effect.gen(function* () {
    // Access services
    const hydra = yield* HydraService;

    yield* Effect.logInfo('Getting logout request info').pipe(Effect.annotateLogs({ challenge }));

    const logoutRequest = yield* hydra.getLogoutRequest(challenge);

    return {
      challenge,
      subject: logoutRequest.subject,
    };
  });

/**
 * Accept logout request
 */
export const acceptLogout = (challenge: string): Effect.Effect<string, AppError, HydraService> =>
  Effect.gen(function* () {
    // Access services
    const hydra = yield* HydraService;

    yield* Effect.logInfo('Accepting logout request').pipe(Effect.annotateLogs({ challenge }));

    const redirectTo = yield* hydra.acceptLogoutRequest(challenge);

    yield* Effect.logInfo('Logout accepted, redirecting').pipe(
      Effect.annotateLogs({
        redirect_to: redirectTo.redirect_to,
      }),
    );

    return String(redirectTo.redirect_to);
  });

/**
 * Reject logout request
 */
export const rejectLogout = (challenge: string): Effect.Effect<void, AppError, HydraService> =>
  Effect.gen(function* () {
    // Access services
    const hydra = yield* HydraService;

    yield* Effect.logInfo('Rejecting logout request').pipe(Effect.annotateLogs({ challenge }));

    yield* hydra.rejectLogoutRequest(challenge);
  });
