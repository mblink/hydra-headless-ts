import { Effect, pipe, Schema } from 'effect';
import { OAuth2ApiService } from './api/oauth2.js';
import { appConfig } from './config.js';
import { HttpStatusError, type HttpError } from './fp/errors.js';
import { validateCreateClient } from './fp/validation.js';
import type { OAuth2Client as OryOAuth2Client } from '@ory/client-fetch';

export const newClient = (clientName: string) => {
  const newClientIn = {
    client_name: clientName,
    grant_types: ['authorization_code', 'refresh_token'],
    scope: 'openid email profile offline offline_access profile',
    response_types: ['code'],
    redirect_uris: [`${appConfig.baseUrl}/callback`, 'https://claude.ai/api/mcp_callback_auth'],
    token_endpoint_auth_method: 'none',
  };
  return pipe(
    OAuth2ApiService,
    Effect.flatMap((api: OAuth2ApiService) => api.createClient(newClientIn)),
  );
};
export const getClient = (clientId: string) =>
  pipe(
    OAuth2ApiService,
    Effect.flatMap((api) => api.getClient(clientId)),
  );
export const safeGetClient = (
  clientId: string,
): Effect.Effect<OryOAuth2Client, string | HttpError, OAuth2ApiService> => {
  return pipe(
    OAuth2ApiService,
    Effect.flatMap((api) => api.getClient(clientId)),
    Effect.flatMap((possibleValue) =>
      possibleValue ? Effect.succeed(possibleValue) : Effect.fail(`No Client found with id ${clientId}`),
    ),
  );
};
export const listClients = () =>
  pipe(
    OAuth2ApiService,
    Effect.flatMap((api) => api.listClients()),
  );

//Don't need to create clients at the moment
// Creating clients needs thought into how they interact with the system
export const createClient = (clientId: string) =>
  pipe(
    listClients(),
    Effect.map((clients: OryOAuth2Client[]) =>
      clients.map((client) => client.client_id).filter((id): id is string => id !== undefined),
    ),
    Effect.flatMap((clientIds: string[]) => validateCreateClient(clientId, clientIds)),
  );
