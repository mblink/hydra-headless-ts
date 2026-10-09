/**
 * Example usage of the Effect-based OAuth2 API service
 *
 * This file demonstrates how to use the new OAuth2ApiService
 * with Effect's error handling and composition patterns.
 */

import { Effect, pipe } from 'effect';
import { OAuth2ApiLayer } from '../setup/hydra.js';
import { OAuth2ApiService } from './oauth2.js';
import type { HttpError } from '../fp/errors.js';
import type { OAuth2Client } from '@ory/client-fetch';

/**
 * Example 1: Get a login request
 */
export const getLoginExample = (loginChallenge: string) =>
  pipe(
    OAuth2ApiService,
    Effect.flatMap((api) => api.getLoginRequest(loginChallenge)),
    Effect.tap((loginRequest) => Effect.sync(() => console.log('Login request:', loginRequest))),
    Effect.catchAll((error: HttpError) => Effect.sync(() => console.error('Failed to get login request:', error))),
  );

/**
 * Example 2: Accept a login request with error recovery
 */
export const acceptLoginExample = (loginChallenge: string, subject: string) =>
  pipe(
    OAuth2ApiService,
    Effect.flatMap((api) =>
      api.acceptLoginRequest(loginChallenge, {
        subject,
        remember: true,
        remember_for: 3600,
      }),
    ),
    Effect.map((redirect) => redirect.redirect_to),
    Effect.catchTag('HttpStatusError', (error) => Effect.succeed(`Error ${error.status}: ${error.statusText}`)),
  );

/**
 * Example 3: Sequential operations with flatMap
 */
export const loginAndConsentFlow = (loginChallenge: string, consentChallenge: string, subject: string) =>
  pipe(
    OAuth2ApiService,
    Effect.flatMap((api) =>
      pipe(
        // First, accept the login
        api.acceptLoginRequest(loginChallenge, {
          subject,
          remember: true,
        }),
        // Then, get the consent request
        Effect.flatMap(() => api.getConsentRequest(consentChallenge)),
        // Finally, accept the consent
        Effect.flatMap((consentRequest) =>
          api.acceptConsentRequest(consentChallenge, {
            grant_scope: consentRequest.requested_scope,
            grant_access_token_audience: consentRequest.requested_access_token_audience,
            remember: true,
          }),
        ),
      ),
    ),
  );

/**
 * Example 4: Using the Layer for dependency injection
 */
export const runWithLayer = (loginChallenge: string) => {
  const program = pipe(
    OAuth2ApiService,
    Effect.flatMap((api) => api.getLoginRequest(loginChallenge)),
  );

  // Provide the OAuth2ApiLayer to the program
  return Effect.runPromise(Effect.provide(program, OAuth2ApiLayer));
};

/**
 * Example 5: Handling multiple operations with Effect.all
 */
export const getMultipleClients = (clientIds: string[]) =>
  pipe(
    OAuth2ApiService,
    Effect.flatMap((api) =>
      Effect.all(
        clientIds.map((id) => api.getClient(id)),
        { concurrency: 'unbounded' }, // Run all requests in parallel
      ),
    ),
  );

/**
 * Example 6: Conditional logic with Effect
 */
export const conditionalLogout = (logoutChallenge: string, shouldAccept: boolean) =>
  pipe(
    OAuth2ApiService,
    Effect.flatMap((api) =>
      shouldAccept
        ? api.acceptLogoutRequest(logoutChallenge)
        : pipe(
            api.rejectLogoutRequest(logoutChallenge),
            Effect.map(() => ({ redirect_to: '/login' as const })),
          ),
    ),
  );

/**
 * Example 7: Token introspection with validation
 */
export const introspectAndValidate = (token: string, requiredScope: string) =>
  pipe(
    OAuth2ApiService,
    Effect.flatMap((api) => api.introspectToken(token)),
    Effect.filterOrFail(
      (introspected) => introspected.active === true,
      () => new Error('Token is not active'),
    ),
    Effect.filterOrFail(
      (introspected) => introspected.scope?.includes(requiredScope) ?? false,
      () => new Error(`Token does not have required scope: ${requiredScope}`),
    ),
  );

/**
 * Example 8: Client management with retry logic
 */
export const createClientWithRetry = (client: OAuth2Client) =>
  pipe(
    OAuth2ApiService,
    Effect.flatMap((api) => api.createClient(client)),
    Effect.retry({ times: 3 }),
    Effect.timeout('10 seconds'),
  );

/**
 * Example 9: List clients with pagination
 */
export const getAllClients = (pageSize = 100) =>
  pipe(
    OAuth2ApiService,
    Effect.flatMap((api) => api.listClients({ pageSize })),
  );

/**
 * Example 10: Error transformation
 */
export const getClientWithFriendlyError = (clientId: string) =>
  pipe(
    OAuth2ApiService,
    Effect.flatMap((api) => api.getClient(clientId)),
    Effect.mapError((error: HttpError) => {
      if (error._tag === 'HttpStatusError' && error.status === 404) {
        return new Error(`Client with ID "${clientId}" not found`);
      }
      if (error._tag === 'NetworkError') {
        return new Error('Network error: Unable to connect to OAuth2 server');
      }
      return new Error(`Failed to get client: ${error._tag}`);
    }),
  );
