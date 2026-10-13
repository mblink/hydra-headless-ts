# OAuth2 Authorization Flow Architecture

## Overview

This service implements a **headless OAuth2 login/consent provider** that bridges Ory Hydra (OAuth2 server with DCR) and Google OAuth (identity provider without DCR support).

## The DCR Bridge Problem

### What is Dynamic Client Registration (DCR)?

**Dynamic Client Registration** (RFC 7591) allows OAuth2 clients to register themselves programmatically at runtime, rather than requiring manual, out-of-band registration with the authorization server.

```text
Traditional OAuth2:
Client → Manual Registration → Get client_id/secret → Use in flows

With DCR:
Client → POST /register → Receive client_id/secret → Use in flows
```

### The Incompatibility

- **Ory Hydra**: OAuth2 & OpenID Connect server that expects DCR-capable identity providers
- **Google OAuth**: Identity provider that uses traditional static client registration only

**Problem**: Hydra's architecture assumes the upstream identity provider supports DCR, but Google does not.

**Solution**: This service acts as a bridge, implementing Hydra's login/consent interface while managing static Google OAuth credentials.

## The CIMD Bridge (an alternative to DCR)

**Client ID Metadata Documents** (CIMD, draft-ietf-oauth-client-id-metadata-document) are a newer alternative to DCR: instead of a registration call, the client's `client_id` *is* an `https://` URL, and this service fetches a JSON metadata document from that URL (the same kind of fields a DCR registration would produce — `redirect_uris`, `grant_types`, etc.) instead of looking one up in a database. There is no `client_secret` — CIMD is for public clients using PKCE, exactly like this service's existing DCR-registered clients.

CIMD support is off by default (`CIMD_ENABLED`) and, when enabled, is implemented as a small pre-flight step in front of the existing `/oauth2/auth` proxy — not a parallel authorization flow. This was a deliberate choice: tracing the existing DCR bridge shows that Hydra's *only* independent contribution to this pipeline is validating `client_id`/`redirect_uri` against its own admin client DB when `/oauth2/auth` is proxied to it — login, consent, token issuance, and JWT minting are already fully local to this service and never re-validate the client against Hydra. So rather than reimplementing authorization-endpoint semantics for CIMD clients, this service **shadow-registers** them into Hydra's own client DB:

1. `setup/proxy.ts`'s `enhancedProxyMiddleware` detects an `https://`-shaped `client_id` on `/oauth2/auth` (an opaque DCR client_id falls straight through, unchanged).
2. `fp/services/cimd.ts` fetches the document at that URL and validates it against `CimdMetadataSchema` (`fp/domain.ts`). This is the SSRF-sensitive boundary of the feature, since the URL is client-supplied: only `https://`, only publicly-routable resolved addresses (checked and then *pinned* for the actual connection, closing the DNS-rebinding TOCTOU gap), no redirects followed, and hard timeout/size caps.
3. The request's `redirect_uri` is checked against the document locally (fail fast, before touching Hydra).
4. `authFlow.upsertCimdClient` idempotently mirrors the validated document into Hydra's admin client DB (`POST`/`PUT /admin/clients/{id}`, with `client_id` set explicitly to the URL — the public DCR endpoint always mints its own id, but the admin API accepts a caller-supplied one, which is what makes this possible), stamping a content hash into Hydra's own free-form `metadata` field so re-fetches are only re-applied when the remote document actually changes.
5. A short-TTL Redis cache (`fp/services/redis.ts`'s `getCimdMetadata`/`setCimdMetadata`) avoids re-fetching and re-upserting on every single authorization request.
6. Once shadow-registered, the proxied `/oauth2/auth` request continues exactly as it would for a DCR client — Hydra's own validation now passes, and login, consent, callback, and `/oauth2/token` require **zero** CIMD-specific changes, because none of them re-validate the client against Hydra today.

The `/.well-known/oauth-authorization-server` discovery document (`routes/discovery-fp.ts`) advertises `client_id_metadata_document_supported: true` when the feature is enabled; it composes Hydra's own document rather than nginx blind-proxying it, since Hydra itself has no notion of CIMD.

## Architecture Diagram

```ascii
┌─────────────────┐
│ Client App      │
│ (Claude.ai)     │
└────────┬────────┘
         │ 1. Initiate OAuth2 flow
         ↓
┌─────────────────────────────────────────┐
│ Ory Hydra (OAuth2 Server)               │
│ - Requires DCR from identity providers  │
│ - Issues: /oauth2/auth, /token, etc.    │
└────────┬────────────────────────────────┘
         │ 2. Login challenge
         ↓
┌─────────────────────────────────────────┐
│ THIS SERVICE (DCR Bridge)               │
│ ┌─────────────────────────────────────┐ │
│ │ Effect-ts Functional Layer          │ │
│ │ - Login/Consent/Logout handlers     │ │
│ │ - PKCE state management             │ │
│ │ - Redis session storage             │ │
│ │ - @kitajs/html templates            │ │
│ └─────────────────────────────────────┘ │
└────────┬────────────────────────────────┘
         │ 3. Authenticate user
         ↓
┌─────────────────────────────────────────┐
│ Google OAuth (Identity Provider)        │
│ - Static client registration only       │
│ - No DCR support                         │
└─────────────────────────────────────────┘
```

## OAuth2 Flows Supported

### 1. Authorization Code Flow with PKCE

The flow Claude's MCP connector uses, and the one most changes here touch. It is one round trip across nine requests and three parties (the client, Hydra, Google), with this app in the middle of most of them. Each leg depends on what earlier legs stored, rewrote or set as a cookie, so a change to one leg can break another that its own tests never reach.

**Before changing anything on this path, read this section and work through the checklist at the end of it.** That covers `src/setup/proxy.ts`, the login, consent and callback routes and services, `fp/services/token.ts`, the session and cookie settings in `src/app.ts`, `routes/discovery-fp.ts`, `CLIENT_SCOPE` in `src/authFlow.ts`, and the nginx and HAProxy config in front of these paths.

#### The legs

| # | Request | Sent by | What happens | State it reads or writes | Depends on |
|---|---|---|---|---|---|
| 1 | `GET /.well-known/oauth-authorization-server` | Claude's server | `routes/discovery-fp.ts` returns Hydra's document with `scopes_supported` replaced by `CLIENT_SCOPE` (`openid email profile offline_access`), plus `client_id_metadata_document_supported` when CIMD is on. | — | Claude requests these scopes when the protected resource metadata (`db-tools.json`) lists none, so every scope here must be in every client's Hydra `scope`. |
| 2 | `POST /oauth2/register` (DCR only) | Claude's server | The proxy rejects redirect URIs outside the allowlist, turns `contacts: null` into `[]`, fills in `scope: CLIENT_SCOPE` when it's missing, and forwards to Hydra. | Hydra's client table | Without a scope, Hydra gives the client `offline_access offline openid`, and leg 3 then fails with `invalid_scope` for `email`. CIMD clients skip this leg and are shadow-registered on leg 3. |
| 3 | `GET /oauth2/auth` (first leg) | Browser, from claude.ai | The proxy accepts only GET with each parameter once. It requires `client_id`, `redirect_uri`, `response_type=code`, `state` and an S256 `code_challenge`, and checks `redirect_uri` against the allowlist. It runs the CIMD pre-flight, then forwards to Hydra without `code_challenge(_method)` and with a random flow id as `state`. Hydra checks the client, redirect URI and scopes (an `invalid_scope` is a 303 to the client's `redirect_uri`), sets its login CSRF cookie and redirects to `/login`. | Writes `pkce_session:<flowId>` (1 h): the client's challenge, `state`, `client_id`, `redirect_uri`, `scope` and the browser's session id. Writes to `req.session`, which makes express-session set the session cookie. | The session cookie is `Secure` outside local, and express-session silently skips it unless the request looks like https. nginx must forward `X-Forwarded-Proto` as `https` (`$http_x_forwarded_proto`, not `$scheme`), and the app trusts one proxy hop. |
| 4 | `GET /login?login_challenge=…` | Browser (Hydra's redirect) | Auto-accepts the login with a placeholder subject. Hydra's `redirect_to` is leg 5. | — | — |
| 5 | `GET /oauth2/auth?…&login_verifier=…` (login return) | Browser (Hydra's redirect) | Hydra builds this URL from the query the proxy sent it on leg 3, so it has **no `code_challenge`** and the flow id as `state`. The proxy runs the same parameter checks except `code_challenge`, then loads the flow by `state`. Only if the flow's session id, `client_id` and `redirect_uri` all match does it forward the request to Hydra unchanged. Otherwise it returns 400 `Authorization request not found or expired`. | Reads `pkce_session:<flowId>` | The session cookie from leg 3, and Hydra's CSRF cookie. |
| 6 | `GET /consent?consent_challenge=…` | Browser (Hydra's redirect) | Reads the flow id from the consent request's `request_url`, which Hydra keeps as the leg 3 URL whatever leg 5 said. It accepts consent with the requested scopes and redirects to Google with the flow id as `state`, `scope=openid profile email` and `access_type=offline`. There is no `consent_verifier` leg back to `/oauth2/auth`. | — | Hydra keeping leg 3's URL as `request_url`. |
| 7 | Google sign-in | Browser | Google redirects to `/callback` (`REDIRECT_URL`) with its `code` and our `state`. | — | The session cookie is `SameSite=Lax`, so it still arrives on this cross-site top-level redirect. `Strict` would drop it. |
| 8 | `GET /callback?code=…&state=…` | Browser (Google's redirect) | Loads the flow by `state` and rejects it unless it belongs to this browser session. Exchanges the code with Google, verifies the ID token, and requires `email_verified` and the email allowlist. Redirects to the client's `redirect_uri` with a new code of ours and the client's original `state`. | Reads and then deletes `pkce_session:<flowId>`. Writes `auth_code:<code>` (Google tokens and the Google `sub`) and `auth_code_state:<code>` (the flow), both for 5 min. | The session cookie from leg 3. |
| 9 | `POST /oauth2/token` (`authorization_code`) | Claude's server | `fp/services/token.ts` consumes the code once. It requires the same `client_id` and `redirect_uri` as the flow, checks `code_verifier` against the stored S256 challenge, and checks the allowlist again. It issues our JWT access token and our refresh token. | Reads and deletes `auth_code:*` and `auth_code_state:*`. Writes `google_token:<jti>` and `jwt_refresh:<token>`. | — |

Later `refresh_token` grants (section 3) only use the state written on leg 9.

#### What crosses legs

- **`state` means three different things.** On leg 3 it's the client's `state`, which is stored and returned on leg 8. From the proxy onward it's our flow id: Hydra's `state` on legs 3 and 5, the `state` in leg 6's `request_url`, and Google's `state` on legs 7 and 8. Changing what goes into `state` on leg 3 changes legs 5 to 8.
- **A parameter the proxy removes or rewrites on leg 3 comes back changed on leg 5.** Hydra builds the login return from what it was sent, not what the client sent. A new requirement on `/oauth2/auth` has to say what happens on leg 5. Requiring `code_challenge` on every request broke every sign-in for this reason (d561bd7, fixed in #30).
- **The session cookie set on leg 3 has to come back on legs 5 and 8.** That depends on `Secure` plus `X-Forwarded-Proto` through HAProxy and nginx, `trust proxy`, and `SameSite=Lax`. The flow tests don't run behind a proxy, so the deploy config matters as much as the code here. See `STAGING_TROUBLESHOOTING.md` → "App startup and sessions".
- **The scopes Claude requests must be a subset of the client's Hydra `scope`.** Leg 1 decides what Claude asks for. Legs 2 and 3 (CIMD) decide what the client carries, and `newClient` covers CLI-made clients. All of them use `CLIENT_SCOPE`.

#### Before changing this path

1. List every leg the change touches. Include legs it affects only through what it stores, removes, rewrites, requires or sets as a cookie.
2. For every parameter, header or cookie the change requires, rewrites or drops, check every leg that sends it. Leg 5 is built by Hydra from leg 3's forwarded query, so check it in particular.
3. Run `npm test` (the fake-Hydra flow test) and `./scripts/hydra-flow-test.sh` (real Hydra). If the change adds a check or a leg, extend `src/test/authFlow.ts` so the flow tests exercise it.
4. If it touches cookies, sessions, headers, redirect URLs or anything nginx and HAProxy forward, check the deploy layer as well. The tests talk to the app directly over http.
5. In the PR, name the legs the change touches and how each was checked. Run a real sign-in on staging before calling it done.

The reason for the checklist is that a security fix which breaks sign-in can't be deployed, so it protects nothing. In October 2026, two correct fixes (requiring `code_challenge`, and binding the flow to the browser session) were each made without considering leg 5 or the proxy in front of the app. They broke sign-in, which kept them off staging until #30 and the nginx `X-Forwarded-Proto` fix.

**Key Files:**

- [src/setup/proxy.ts](src/setup/proxy.ts) - Legs 2, 3 and 5
- [src/routes/login-fp.ts](src/routes/login-fp.ts), [src/fp/services/login.ts](src/fp/services/login.ts) - Leg 4
- [src/routes/consent-fp.ts](src/routes/consent-fp.ts), [src/fp/services/consent.ts](src/fp/services/consent.ts) - Leg 6
- [src/routes/callback-fp.ts](src/routes/callback-fp.ts), [src/fp/services/callback.ts](src/fp/services/callback.ts) - Leg 8
- [src/routes/passthrough-auth-fp.ts](src/routes/passthrough-auth-fp.ts), [src/fp/services/token.ts](src/fp/services/token.ts) - Leg 9
- [src/routes/discovery-fp.ts](src/routes/discovery-fp.ts) - Leg 1
- [src/app.ts](src/app.ts) - Middleware order and session cookie settings
- [src/test/authFlow.ts](src/test/authFlow.ts) - Drives legs 1 to 9 for both flow tests

### 2. Device Authorization Flow (RFC 8628)

For devices with limited input capabilities (smart TVs, IoT, CLI tools).

```ascii
Device → Hydra /oauth2/device/auth
          ↓
       Device code + User code
          ↓
Device displays: "Go to https://auth.example.com/device and enter: ABCD-EFGH"
          ↓
User visits URL → This Service /device/verify
          ↓
User enters code → Validate with Hydra
          ↓
Authenticate via Google OAuth
          ↓
Device polls Hydra → Receives tokens
```

**Key Files:**

- [src/views/device/verify.tsx](src/views/device/verify.tsx) - Device code entry template
- [src/views/device/success.tsx](src/views/device/success.tsx) - Success page template
- [src/routes/device.ts](src/routes/device.ts) - Device flow handlers

### 3. Token Refresh Flow

Refreshes expired access tokens using refresh tokens.

```ascii
Client → Hydra /oauth2/token (grant_type=refresh_token)
          ↓
       Hydra validates refresh token
          ↓
       This Service refreshes Google tokens
          ↓
       Hydra issues new access token
```

**Key Files:**

- [src/fp/services/google.ts](src/fp/services/google.ts) - Google token refresh logic

### 4. Logout Flow (RP-Initiated)

Terminates OAuth2 sessions.

```ascii
Client → Hydra /oauth2/sessions/logout
          ↓
       Logout Challenge → This Service
          ↓
       User confirms logout
          ↓
       Revoke Hydra session
          ↓
       Revoke Google OAuth tokens
          ↓
       Clear cookies
```

**Key Files:**

- [src/views/logout.tsx](src/views/logout.tsx) - Logout confirmation template
- [src/routes/logout-fp.ts](src/routes/logout-fp.ts) - Logout handler
- [src/fp/services/logout.ts](src/fp/services/logout.ts) - Logout business logic

## State Management

### PKCE (Proof Key for Code Exchange)

Used to prevent authorization code interception attacks. RFC 7636.

```typescript
// pkce_session:<flowId>, for 1 hour (see leg 3 above)
interface PKCEState {
  code_challenge: string        // the client's S256 challenge
  code_challenge_method: 'S256'
  scope: string                 // requested scopes
  state: string                 // the client's own state, returned on leg 8
  redirect_uri: string
  client_id: string
  timestamp: number
  session_id?: string           // the express session that started the flow
}
```

### Redis keys

- **Authorization flow**: `pkce_session:{flowId}`, 1 hour
- **Authorization codes**: `auth_code:{code}` and `auth_code_state:{code}`, 5 minutes
- **Google tokens**: `google_token:{jti}`, 30 days
- **Our refresh tokens**: `jwt_refresh:{token}`
- **CIMD metadata cache**: `cimd_metadata:{client_id}`

Express sessions are in Postgres (`connect-pg-simple`, table `session`), not Redis.

**Key Files:**

- [src/fp/services/redis.ts](src/fp/services/redis.ts) - Redis service with Effect
- [src/fp/domain.ts](src/fp/domain.ts) - Schema definitions for state objects

## Security Considerations

### CSRF Protection

- All forms include CSRF tokens via `csrf-csrf` middleware
- Token validation on all POST requests

### PKCE

- Code challenge/verifier pairs prevent auth code interception
- S256 (SHA-256) method used for code challenges

### State Parameter

- The client's `state` is stored on leg 3 and returned unchanged on leg 8
- Hydra and Google see our random flow id instead. `/callback` only accepts it from the browser session that started the flow, which stops login CSRF

### Session Security

- HTTP-only cookies
- Secure flag in production
- Session stored in PostgreSQL (not in-memory)
- Configurable session TTL

### Token Storage

- Access/refresh tokens stored in Redis with encryption
- TTL-based expiration
- Tokens never exposed to client-side JavaScript

## Technology Stack

### Functional Programming (Effect-ts)

All business logic uses **Effect** for:

- **Type-safe error handling**: No exceptions, all errors typed
- **Dependency injection**: Layer-based service composition
- **Composability**: Pure functions that compose cleanly
- **Testability**: Easy mocking via Layer replacement

**Example:**

```typescript
// src/fp/services/login.ts
export const processLogin = (
  challenge: string,
  subject: string
): Effect.Effect<string, AppError, HydraService | Logger> =>
  Effect.gen(function* () {
    const hydra = yield* HydraService
    const logger = yield* Logger

    yield* logger.info('Processing login', { challenge, subject })

    const loginRequest = yield* hydra.getLoginRequest(challenge)

    if (loginRequest.skip) {
      return yield* hydra.acceptLoginRequest(challenge, { subject })
    }

    // ... more logic
  })
```

### Type Safety (@kitajs/html)

All HTML templates are type-safe TypeScript functions:

- **Compile-time validation**: Props interfaces checked by TypeScript
- **No runtime overhead**: Compiles to string concatenation
- **Refactoring support**: Rename refactoring works across templates
- **IntelliSense**: Full autocomplete for props and HTML elements

**Example:**

```typescript
// src/views/logout.tsx
export interface LogoutProps {
  action: string
  envXsrfToken: string
  csrfToken: string
  challenge: string
}

export function Logout({ action, envXsrfToken, csrfToken, challenge }: LogoutProps): string {
  return Layout({ /* ... */ })
}
```

### Schema Validation (Effect Schema)

All external data validated with Effect Schema:

- **Runtime validation**: Ensures data matches expected shape
- **Type inference**: TypeScript types inferred from schemas
- **Decode/Encode**: Bidirectional transformations
- **Custom validators**: Business rules encoded in schemas

**Example:**

```typescript
// src/fp/domain.ts
export const PKCEStateSchema = Schema.Struct({
  code_challenge: Schema.String,
  code_challenge_method: Schema.Literal('S256'),
  scope: Schema.String,
  state: Schema.String,
  redirect_uri: Schema.String,
  client_id: Schema.String,
  timestamp: Schema.Number,
})

export type PKCEState = Schema.Schema.Type<typeof PKCEStateSchema>
```

### Service Layer Pattern

Services defined as Effect Context.Tag for dependency injection:

```typescript
// src/fp/services/hydra.ts
export class HydraService extends Context.Tag('HydraService')<
  HydraService,
  {
    getLoginRequest: (challenge: string) => Effect.Effect<OAuth2LoginRequest, AppError>
    acceptLoginRequest: (challenge: string, body: AcceptOAuth2LoginRequest) => Effect.Effect<string, AppError>
    // ... more methods
  }
>() {}

// src/fp/bootstrap.ts - Layer composition
export const createAppLayer = (
  redisClient: Redis,
  oauth2Config: OAuth2Config,
  logger: TsLogger,
  googleConfig: GoogleOAuthConfig
): Layer.Layer<HydraService | RedisService | Logger | GoogleOAuthService> =>
  Layer.mergeAll(
    HydraServiceLive(oauth2Config),
    RedisServiceLive(redisClient),
    LoggerServiceLive(logger),
    GoogleOAuthServiceLive(googleConfig)
  )
```

## Testing Strategy

- **Unit tests** (`src/**/*.test.ts`, `npm test`): services and routes with mock layers, and `src/setup/proxy.test.ts` for the proxy's per-request checks.
- **Flow test against a fake Hydra** (`src/test/auth-flow.test.ts`, part of `npm test`): drives legs 1 to 9 of the authorization code flow through `createApp()`, following every redirect with cookies, with a fake Google. `src/test/fakeHydra.ts` copies what Hydra v25 was observed to do.
- **Flow test against a real Hydra** (`src/test/auth-flow.hydra.test.ts`, `npm run test:hydra`): the same flow against Hydra v25. Locally, `./scripts/hydra-flow-test.sh` starts Hydra in Docker; in CI it's the `hydra-flow-test` step. It catches the fake being wrong about Hydra.

Neither flow test covers nginx and HAProxy, TLS, a real Google sign-in or fetching CIMD metadata over https, so a change that touches those needs a sign-in on staging too (see "Before changing this path" above).

## Configuration

Environment-based configuration using Effect Config:

```typescript
// src/fp/config.ts
export const appConfigEffect = Config.all({
  environment: Config.string('APP_ENV').pipe(Config.withDefault('local')),
  baseUrl: Config.string('BASE_URL'),
  publicDomain: Config.string('PUBLIC_DOMAIN'),
  hydraPublicUrl: Config.string('HYDRA_PUBLIC_URL'),
  googleClientId: Config.string('GOOGLE_CLIENT_ID'),
  googleClientSecret: Config.string('GOOGLE_CLIENT_SECRET'),
  // ... more config
})
```

**Environment Files:**

At runtime the server reads env files from `/etc/hydra-headless-ts/` (see [DEVELOPMENT.md](DEVELOPMENT.md#environment-configuration)). The checked-in examples are:

- [src/env/local.env](src/env/local.env) - Local development
- [src/env/staging.env](src/env/staging.env) - Staging environment

## Error Handling

All errors typed using Effect's error channel:

```typescript
// src/fp/errors.ts
export class HttpStatusError extends Data.TaggedError('HttpStatusError')<{
  status: number
  statusText: string
}> {}

export class NetworkError extends Data.TaggedError('NetworkError')<{
  message: string
  cause?: unknown
}> {}

export class GoogleAuthError extends Data.TaggedError('GoogleAuthError')<{
  error: string
  errorDescription: string
}> {}

// ... more error types

export type AppError =
  | HttpStatusError
  | NetworkError
  | GoogleAuthError
  | RedisKeyNotFound
  | RedisParseError
  | SchemaValidationError
```

Errors are handled functionally using Effect.either:

```typescript
const result = await Effect.runPromise(Effect.either(program))

if (result._tag === 'Left') {
  // Handle error
  const error: AppError = result.left
} else {
  // Handle success
  const value = result.right
}
```

## Resources

### OAuth2 & OpenID Connect Specifications

- [RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749) - OAuth 2.0 Authorization Framework
- [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) - PKCE
- [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591) - Dynamic Client Registration (DCR)
- [RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628) - Device Authorization Grant
- [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)

### Ory Hydra Documentation

- [Hydra Overview](https://www.ory.sh/hydra/docs/)
- [Login & Consent Flow](https://www.ory.sh/hydra/docs/concepts/login)
- [Logout Flow](https://www.ory.sh/hydra/docs/concepts/logout)

### Effect-ts Documentation

- [Effect Website](https://effect.website/)
- [Effect Schema](https://effect.website/docs/schema/introduction)
- [Effect Layers](https://effect.website/docs/guides/context-management/layers)

### Related Documentation

- [EFFECT_MIGRATION.md](EFFECT_MIGRATION.md) - fp-ts → Effect migration notes
- [TEMPLATE_MIGRATION_COMPLETE.md](TEMPLATE_MIGRATION_COMPLETE.md) - Pug → @kitajs/html migration
- [DEVELOPMENT.md](DEVELOPMENT.md) - Development guide
- [QUALITY_BASELINE.md](QUALITY_BASELINE.md) - Testing and quality infrastructure
