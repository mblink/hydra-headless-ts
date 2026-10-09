/**
 * Hydra Admin API service using Effect
 * Wraps all Hydra OAuth2 API operations
 */
import { Effect, Context, Layer } from 'effect';
import { HttpStatusError, NetworkError } from '../errors.js';
import type { HttpError } from '../errors.js';
import type {
  OAuth2LoginRequest,
  AcceptOAuth2LoginRequest,
  OAuth2RedirectTo,
  OAuth2ConsentRequest,
  AcceptOAuth2ConsentRequest,
  OAuth2LogoutRequest,
} from '@ory/client-fetch';
import type { OAuth2Api } from '@ory/hydra-client-fetch/dist/index.js';

/**
 * Hydra service interface
 */
export interface HydraService {
  readonly getLoginRequest: (challenge: string) => Effect.Effect<OAuth2LoginRequest, HttpError>;

  readonly acceptLoginRequest: (
    challenge: string,
    body: AcceptOAuth2LoginRequest,
  ) => Effect.Effect<OAuth2RedirectTo, HttpError>;

  readonly getConsentRequest: (challenge: string) => Effect.Effect<OAuth2ConsentRequest, HttpError>;

  readonly acceptConsentRequest: (
    challenge: string,
    body: AcceptOAuth2ConsentRequest,
  ) => Effect.Effect<OAuth2RedirectTo, HttpError>;

  readonly getLogoutRequest: (challenge: string) => Effect.Effect<OAuth2LogoutRequest, HttpError>;

  readonly acceptLogoutRequest: (challenge: string) => Effect.Effect<OAuth2RedirectTo, HttpError>;

  readonly rejectLogoutRequest: (challenge: string) => Effect.Effect<void, HttpError>;
}

/**
 * Hydra service tag
 */
export const HydraService = Context.GenericTag<HydraService>('HydraService');

/**
 * Create Hydra service from OAuth2Api client
 */
export const makeHydraService = (client: OAuth2Api): HydraService => {
  /**
   * Helper to wrap Hydra API calls in Effect
   */
  const wrapHydraCall = <A>(operation: () => Promise<A>, operationName: string): Effect.Effect<A, HttpError> =>
    Effect.tryPromise({
      try: operation,
      catch: (error): HttpError => {
        const err = error as {
          response?: { status?: number; statusText?: string; data?: unknown };
        };
        if (err.response) {
          return new HttpStatusError({
            status: err.response.status ?? 500,
            statusText: err.response.statusText ?? 'Hydra API error',
            body: err.response.data,
          });
        }
        return new NetworkError({
          message: `Hydra ${operationName} failed`,
          cause: error,
        });
      },
    });

  return {
    getLoginRequest: (challenge: string) =>
      wrapHydraCall(() => client.getOAuth2LoginRequest({ loginChallenge: challenge }), 'getLoginRequest'),

    acceptLoginRequest: (challenge: string, body: AcceptOAuth2LoginRequest) =>
      wrapHydraCall(
        () =>
          client.acceptOAuth2LoginRequest({
            loginChallenge: challenge,
            acceptOAuth2LoginRequest: body,
          }),
        'acceptLoginRequest',
      ),

    getConsentRequest: (challenge: string) =>
      wrapHydraCall(() => client.getOAuth2ConsentRequest({ consentChallenge: challenge }), 'getConsentRequest'),

    acceptConsentRequest: (challenge: string, body: AcceptOAuth2ConsentRequest) =>
      wrapHydraCall(
        () =>
          client.acceptOAuth2ConsentRequest({
            consentChallenge: challenge,
            acceptOAuth2ConsentRequest: body,
          }),
        'acceptConsentRequest',
      ),

    getLogoutRequest: (challenge: string) =>
      wrapHydraCall(() => client.getOAuth2LogoutRequest({ logoutChallenge: challenge }), 'getLogoutRequest'),

    acceptLogoutRequest: (challenge: string) =>
      wrapHydraCall(() => client.acceptOAuth2LogoutRequest({ logoutChallenge: challenge }), 'acceptLogoutRequest'),

    rejectLogoutRequest: (challenge: string) =>
      wrapHydraCall(async () => {
        await client.rejectOAuth2LogoutRequest({ logoutChallenge: challenge });
      }, 'rejectLogoutRequest'),
  };
};

/**
 * Create a Layer for HydraService
 */
export const HydraServiceLive = (client: OAuth2Api) => Layer.succeed(HydraService, makeHydraService(client));
