/**
 * Local OAuth2 API implementation using Effect
 * Converts @ory/client-fetch OAuth2Api calls to Effect-based operations
 */
import { Effect, Context, Layer } from 'effect';
import { HttpStatusError, NetworkError } from '../fp/errors.js';
import type { HttpError } from '../fp/errors.js';
import type {
  AcceptDeviceUserCodeRequest,
  AcceptOAuth2ConsentRequest,
  AcceptOAuth2LoginRequest,
  DeviceAuthorization,
  ErrorOAuth2,
  IntrospectedOAuth2Token,
  JsonPatch,
  OAuth2Client,
  OAuth2ClientTokenLifespans,
  OAuth2ConsentRequest,
  OAuth2ConsentSession,
  OAuth2LoginRequest,
  OAuth2LogoutRequest,
  OAuth2RedirectTo,
  OAuth2TokenExchange,
  RejectOAuth2Request,
  TrustOAuth2JwtGrantIssuer,
  TrustedOAuth2JwtGrantIssuer,
} from '@ory/client-fetch';

/**
 * Configuration for OAuth2 API
 */
export interface OAuth2ApiConfig {
  basePath: string;
  headers?: Record<string, string>;
  accessToken?: string | ((name: string, scopes?: string[]) => string | Promise<string>);
}

/**
 * Helper to wrap fetch calls in Effect
 */
const wrapFetch = <A>(
  operation: () => Promise<Response>,
  operationName: string,
  parseResponse: (response: Response) => Promise<A>,
): Effect.Effect<A, HttpError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await operation();
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new HttpStatusError({
          status: response.status,
          statusText: response.statusText,
          body,
        });
      }
      return await parseResponse(response);
    },
    catch: (error): HttpError => {
      if (error instanceof HttpStatusError) {
        return error;
      }
      return new NetworkError({
        message: `OAuth2 ${operationName} failed`,
        cause: error,
      });
    },
  });

/**
 * OAuth2 API Service interface
 */
export interface OAuth2ApiService {
  // Consent requests
  readonly acceptConsentRequest: (
    consentChallenge: string,
    body?: AcceptOAuth2ConsentRequest,
  ) => Effect.Effect<OAuth2RedirectTo, HttpError>;

  readonly getConsentRequest: (consentChallenge: string) => Effect.Effect<OAuth2ConsentRequest, HttpError>;

  readonly rejectConsentRequest: (
    consentChallenge: string,
    body?: RejectOAuth2Request,
  ) => Effect.Effect<OAuth2RedirectTo, HttpError>;

  // Login requests
  readonly acceptLoginRequest: (
    loginChallenge: string,
    body?: AcceptOAuth2LoginRequest,
  ) => Effect.Effect<OAuth2RedirectTo, HttpError>;

  readonly getLoginRequest: (loginChallenge: string) => Effect.Effect<OAuth2LoginRequest, HttpError>;

  readonly rejectLoginRequest: (
    loginChallenge: string,
    body?: RejectOAuth2Request,
  ) => Effect.Effect<OAuth2RedirectTo, HttpError>;

  // Logout requests
  readonly acceptLogoutRequest: (logoutChallenge: string) => Effect.Effect<OAuth2RedirectTo, HttpError>;

  readonly getLogoutRequest: (logoutChallenge: string) => Effect.Effect<OAuth2LogoutRequest, HttpError>;

  readonly rejectLogoutRequest: (logoutChallenge: string) => Effect.Effect<void, HttpError>;

  // Device flow
  readonly acceptUserCodeRequest: (
    deviceChallenge: string,
    body?: AcceptDeviceUserCodeRequest,
  ) => Effect.Effect<OAuth2RedirectTo, HttpError>;

  readonly deviceFlow: () => Effect.Effect<DeviceAuthorization, HttpError>;

  readonly performDeviceVerificationFlow: () => Effect.Effect<ErrorOAuth2, HttpError>;

  // Client management
  readonly createClient: (client: OAuth2Client) => Effect.Effect<OAuth2Client, HttpError>;

  readonly getClient: (id: string) => Effect.Effect<OAuth2Client, HttpError>;

  readonly listClients: (params?: {
    pageSize?: number;
    pageToken?: string;
    clientName?: string;
    owner?: string;
  }) => Effect.Effect<OAuth2Client[], HttpError>;

  readonly updateClient: (id: string, client: OAuth2Client) => Effect.Effect<OAuth2Client, HttpError>;

  readonly patchClient: (id: string, patches: JsonPatch[]) => Effect.Effect<OAuth2Client, HttpError>;

  readonly deleteClient: (id: string) => Effect.Effect<void, HttpError>;

  readonly setClientLifespans: (
    id: string,
    lifespans?: OAuth2ClientTokenLifespans,
  ) => Effect.Effect<OAuth2Client, HttpError>;

  // Token management
  readonly introspectToken: (token: string, scope?: string) => Effect.Effect<IntrospectedOAuth2Token, HttpError>;

  readonly revokeToken: (token: string, clientId?: string, clientSecret?: string) => Effect.Effect<void, HttpError>;

  readonly deleteTokens: (clientId: string) => Effect.Effect<void, HttpError>;

  readonly tokenExchange: (params: {
    grantType: string;
    clientId?: string;
    code?: string;
    redirectUri?: string;
    refreshToken?: string;
  }) => Effect.Effect<OAuth2TokenExchange, HttpError>;

  // Session management
  readonly listConsentSessions: (params: {
    subject: string;
    pageSize?: number;
    pageToken?: string;
    loginSessionId?: string;
  }) => Effect.Effect<OAuth2ConsentSession[], HttpError>;

  readonly revokeConsentSessions: (params?: {
    subject?: string;
    client?: string;
    consentRequestId?: string;
    all?: boolean;
  }) => Effect.Effect<void, HttpError>;

  readonly revokeLoginSessions: (params?: { subject?: string; sid?: string }) => Effect.Effect<void, HttpError>;

  // JWT Grant issuers
  readonly trustJwtGrantIssuer: (
    issuer?: TrustOAuth2JwtGrantIssuer,
  ) => Effect.Effect<TrustedOAuth2JwtGrantIssuer, HttpError>;

  readonly getTrustedJwtGrantIssuer: (id: string) => Effect.Effect<TrustedOAuth2JwtGrantIssuer, HttpError>;

  readonly listTrustedJwtGrantIssuers: (params?: {
    pageSize?: number;
    pageToken?: string;
    issuer?: string;
  }) => Effect.Effect<TrustedOAuth2JwtGrantIssuer[], HttpError>;

  readonly deleteTrustedJwtGrantIssuer: (id: string) => Effect.Effect<void, HttpError>;

  // Authorization endpoints
  readonly authorize: () => Effect.Effect<ErrorOAuth2, HttpError>;
}

/**
 * OAuth2 API Service tag
 */
export const OAuth2ApiService = Context.GenericTag<OAuth2ApiService>('OAuth2ApiService');

/**
 * Create OAuth2 API service implementation
 */
export const makeOAuth2ApiService = (config: OAuth2ApiConfig): OAuth2ApiService => {
  const baseUrl = config.basePath;

  /**
   * Helper to build headers with auth token
   */
  const buildHeaders = async (contentType?: string): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {
      ...config.headers,
    };

    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    if (config.accessToken) {
      const token =
        typeof config.accessToken === 'function' ? await config.accessToken('oryAccessToken', []) : config.accessToken;
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    return headers;
  };

  /**
   * Helper to build URL with query params
   */
  const buildUrl = (path: string, params?: Record<string, unknown>): string => {
    const url = new URL(path, baseUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }
    return url.toString();
  };

  /**
   * Generic fetch wrapper
   */
  const fetchJSON = <A>(
    method: string,
    path: string,
    options?: {
      query?: Record<string, unknown>;
      body?: unknown;
      contentType?: string;
    },
  ): Effect.Effect<A, HttpError> =>
    wrapFetch(
      async () => {
        const headers = await buildHeaders(options?.contentType ?? 'application/json');
        const url = buildUrl(path, options?.query);

        return fetch(url, {
          method,
          headers,
          body: options?.body ? JSON.stringify(options.body) : undefined,
        });
      },
      `${method} ${path}`,
      async (response) => {
        const text = await response.text();
        return text ? JSON.parse(text) : undefined;
      },
    );

  /**
   * Fetch with no response body
   */
  const fetchVoid = (
    method: string,
    path: string,
    options?: {
      query?: Record<string, unknown>;
      body?: unknown;
      contentType?: string;
    },
  ): Effect.Effect<void, HttpError> =>
    wrapFetch(
      async () => {
        const headers = await buildHeaders(options?.contentType);
        const url = buildUrl(path, options?.query);

        return fetch(url, {
          method,
          headers,
          body: options?.body ? JSON.stringify(options.body) : undefined,
        });
      },
      `${method} ${path}`,
      async () => undefined,
    );

  /**
   * Fetch with form data
   */
  const fetchForm = <A>(method: string, path: string, formData: Record<string, string>): Effect.Effect<A, HttpError> =>
    wrapFetch(
      async () => {
        const headers = await buildHeaders('application/x-www-form-urlencoded');
        const url = buildUrl(path);
        const body = new URLSearchParams(formData).toString();

        return fetch(url, {
          method,
          headers,
          body,
        });
      },
      `${method} ${path}`,
      async (response) => response.json(),
    );

  return {
    // Consent requests
    acceptConsentRequest: (consentChallenge, body) =>
      fetchJSON<OAuth2RedirectTo>('PUT', '/admin/oauth2/auth/requests/consent/accept', {
        query: { consent_challenge: consentChallenge },
        body,
      }),

    getConsentRequest: (consentChallenge) =>
      fetchJSON<OAuth2ConsentRequest>('GET', '/admin/oauth2/auth/requests/consent', {
        query: { consent_challenge: consentChallenge },
      }),

    rejectConsentRequest: (consentChallenge, body) =>
      fetchJSON<OAuth2RedirectTo>('PUT', '/admin/oauth2/auth/requests/consent/reject', {
        query: { consent_challenge: consentChallenge },
        body,
      }),

    // Login requests
    acceptLoginRequest: (loginChallenge, body) =>
      fetchJSON<OAuth2RedirectTo>('PUT', '/admin/oauth2/auth/requests/login/accept', {
        query: { login_challenge: loginChallenge },
        body,
      }),

    getLoginRequest: (loginChallenge) =>
      fetchJSON<OAuth2LoginRequest>('GET', '/admin/oauth2/auth/requests/login', {
        query: { login_challenge: loginChallenge },
      }),

    rejectLoginRequest: (loginChallenge, body) =>
      fetchJSON<OAuth2RedirectTo>('PUT', '/admin/oauth2/auth/requests/login/reject', {
        query: { login_challenge: loginChallenge },
        body,
      }),

    // Logout requests
    acceptLogoutRequest: (logoutChallenge) =>
      fetchJSON<OAuth2RedirectTo>('PUT', '/admin/oauth2/auth/requests/logout/accept', {
        query: { logout_challenge: logoutChallenge },
      }),

    getLogoutRequest: (logoutChallenge) =>
      fetchJSON<OAuth2LogoutRequest>('GET', '/admin/oauth2/auth/requests/logout', {
        query: { logout_challenge: logoutChallenge },
      }),

    rejectLogoutRequest: (logoutChallenge) =>
      fetchVoid('PUT', '/admin/oauth2/auth/requests/logout/reject', {
        query: { logout_challenge: logoutChallenge },
      }),

    // Device flow
    acceptUserCodeRequest: (deviceChallenge, body) =>
      fetchJSON<OAuth2RedirectTo>('PUT', '/admin/oauth2/auth/requests/device/accept', {
        query: { device_challenge: deviceChallenge },
        body,
      }),

    deviceFlow: () => fetchJSON<DeviceAuthorization>('POST', '/oauth2/device/auth'),

    performDeviceVerificationFlow: () => fetchJSON<ErrorOAuth2>('GET', '/oauth2/device/verify'),

    // Client management
    createClient: (client) => fetchJSON<OAuth2Client>('POST', '/admin/clients', { body: client }),

    getClient: (id) => fetchJSON<OAuth2Client>('GET', `/admin/clients/${encodeURIComponent(id)}`),

    listClients: (params) =>
      fetchJSON<OAuth2Client[]>('GET', '/admin/clients', {
        query: params
          ? {
              page_size: params.pageSize,
              page_token: params.pageToken,
              client_name: params.clientName,
              owner: params.owner,
            }
          : undefined,
      }),

    updateClient: (id, client) =>
      fetchJSON<OAuth2Client>('PUT', `/admin/clients/${encodeURIComponent(id)}`, { body: client }),

    patchClient: (id, patches) =>
      fetchJSON<OAuth2Client>('PATCH', `/admin/clients/${encodeURIComponent(id)}`, {
        body: patches,
      }),

    deleteClient: (id) => fetchVoid('DELETE', `/admin/clients/${encodeURIComponent(id)}`),

    setClientLifespans: (id, lifespans) =>
      fetchJSON<OAuth2Client>('PUT', `/admin/clients/${encodeURIComponent(id)}/lifespans`, {
        body: lifespans,
      }),

    // Token management
    introspectToken: (token, scope) =>
      fetchForm<IntrospectedOAuth2Token>('POST', '/admin/oauth2/introspect', {
        token,
        ...(scope && { scope }),
      }),

    revokeToken: (token, clientId, clientSecret) =>
      fetchForm<void>('POST', '/oauth2/revoke', {
        token,
        ...(clientId && { client_id: clientId }),
        ...(clientSecret && { client_secret: clientSecret }),
      }),

    deleteTokens: (clientId) =>
      fetchVoid('DELETE', '/admin/oauth2/tokens', {
        query: { client_id: clientId },
      }),

    tokenExchange: (params) =>
      fetchForm<OAuth2TokenExchange>('POST', '/oauth2/token', {
        grant_type: params.grantType,
        ...(params.clientId && { client_id: params.clientId }),
        ...(params.code && { code: params.code }),
        ...(params.redirectUri && { redirect_uri: params.redirectUri }),
        ...(params.refreshToken && { refresh_token: params.refreshToken }),
      }),

    // Session management
    listConsentSessions: (params) =>
      fetchJSON<OAuth2ConsentSession[]>('GET', '/admin/oauth2/auth/sessions/consent', {
        query: {
          subject: params.subject,
          page_size: params.pageSize,
          page_token: params.pageToken,
          login_session_id: params.loginSessionId,
        },
      }),

    revokeConsentSessions: (params) =>
      fetchVoid('DELETE', '/admin/oauth2/auth/sessions/consent', {
        query: params
          ? {
              subject: params.subject,
              client: params.client,
              consent_request_id: params.consentRequestId,
              all: params.all,
            }
          : undefined,
      }),

    revokeLoginSessions: (params) =>
      fetchVoid('DELETE', '/admin/oauth2/auth/sessions/login', {
        query: params
          ? {
              subject: params.subject,
              sid: params.sid,
            }
          : undefined,
      }),

    // JWT Grant issuers
    trustJwtGrantIssuer: (issuer) =>
      fetchJSON<TrustedOAuth2JwtGrantIssuer>('POST', '/admin/trust/grants/jwt-bearer/issuers', {
        body: issuer,
      }),

    getTrustedJwtGrantIssuer: (id) =>
      fetchJSON<TrustedOAuth2JwtGrantIssuer>('GET', `/admin/trust/grants/jwt-bearer/issuers/${id}`),

    listTrustedJwtGrantIssuers: (params) =>
      fetchJSON<TrustedOAuth2JwtGrantIssuer[]>('GET', '/admin/trust/grants/jwt-bearer/issuers', {
        query: params
          ? {
              page_size: params.pageSize,
              page_token: params.pageToken,
              issuer: params.issuer,
            }
          : undefined,
      }),

    deleteTrustedJwtGrantIssuer: (id) => fetchVoid('DELETE', `/admin/trust/grants/jwt-bearer/issuers/${id}`),

    // Authorization endpoints
    authorize: () => fetchJSON<ErrorOAuth2>('GET', '/oauth2/auth'),
  };
};

/**
 * Create a Layer for OAuth2ApiService
 */
export const OAuth2ApiServiceLive = (config: OAuth2ApiConfig) =>
  Layer.succeed(OAuth2ApiService, makeOAuth2ApiService(config));
