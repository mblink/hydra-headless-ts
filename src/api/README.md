# OAuth2 API - Effect-Based Implementation

This directory contains a local implementation of the Ory OAuth2 API using Effect for error handling and composition.

## Overview

The `oauth2.ts` file provides a complete Effect-based wrapper around the Ory Hydra OAuth2 API. Instead of using the `@ory/client-fetch` package directly, this implementation uses native `fetch` with Effect's `Effect.Effect` type for better error handling and functional composition.

## Why Effect Instead of Promises?

- **Explicit Error Types**: Every operation returns `Effect.Effect<Success, Error>` making errors visible in the type system
- **Composability**: Chain operations using `pipe`, `flatMap`, `map`, etc.
- **Error Recovery**: Handle errors at any point in the chain with `catchAll`, `catchTag`, etc.
- **Retries & Timeouts**: Built-in support for retry logic and timeouts
- **Dependency Injection**: Use Effect's Context and Layer system for clean DI
- **Parallel Execution**: Run multiple operations concurrently with `Effect.all`

## Architecture

### Service Interface

The `OAuth2ApiService` interface defines all available OAuth2 operations:

```typescript
export interface OAuth2ApiService {
  readonly acceptConsentRequest: (
    consentChallenge: string,
    body?: AcceptOAuth2ConsentRequest
  ) => Effect.Effect<OAuth2RedirectTo, HttpError>

  readonly getLoginRequest: (loginChallenge: string) => Effect.Effect<OAuth2LoginRequest, HttpError>

  // ... 30+ more methods
}
```

### Error Types

All operations can fail with `HttpError`, which is a union of:

- `HttpStatusError` - HTTP errors with status codes (4xx, 5xx)
- `NetworkError` - Network/connection errors

These are defined in [src/fp/errors.ts](../fp/errors.ts).

### Configuration

```typescript
export interface OAuth2ApiConfig {
  basePath: string // e.g., "http://localhost:4445"
  headers?: Record<string, string> // Optional default headers
  accessToken?: string | ((name: string, scopes?: string[]) => string | Promise<string>)
}
```

## Usage

### Basic Setup

```typescript
import { Effect } from 'effect'
import { OAuth2ApiService, OAuth2ApiServiceLive } from './api/oauth2.js'

// Create a Layer for DI
const OAuth2Layer = OAuth2ApiServiceLive({
  basePath: 'http://localhost:4445',
  headers: { 'X-Forwarded-Proto': 'https' },
})

// The examples below use `oauth2Api`, obtained from the context inside an Effect
const program = Effect.gen(function* () {
  const oauth2Api = yield* OAuth2ApiService
  // ...
}).pipe(Effect.provide(OAuth2Layer))
```

### Simple Operation

```typescript
import { Effect, pipe } from 'effect'

const program = pipe(
  oauth2Api.getLoginRequest('challenge_123'),
  Effect.map((loginRequest) => loginRequest.subject),
  Effect.catchAll((error) => Effect.succeed('anonymous'))
)

// Run the program
const result = await Effect.runPromise(program)
```

### Sequential Operations

```typescript
const loginFlow = pipe(
  oauth2Api.getLoginRequest(loginChallenge),
  Effect.flatMap((loginReq) =>
    oauth2Api.acceptLoginRequest(loginChallenge, {
      subject: loginReq.subject || 'user-123',
      remember: true,
    })
  ),
  Effect.map((redirect) => redirect.redirect_to)
)
```

### Parallel Operations

```typescript
const [client1, client2, client3] = await Effect.runPromise(
  Effect.all(
    [
      oauth2Api.getClient('client-1'),
      oauth2Api.getClient('client-2'),
      oauth2Api.getClient('client-3'),
    ],
    { concurrency: 'unbounded' }
  )
)
```

### Error Handling

```typescript
const program = pipe(
  oauth2Api.getClient('unknown-id'),
  Effect.catchTag('HttpStatusError', (error) => {
    if (error.status === 404) {
      return Effect.succeed(null) // Return null for not found
    }
    return Effect.fail(error) // Re-throw other HTTP errors
  }),
  Effect.catchTag('NetworkError', (error) => {
    console.error('Network error:', error.message)
    return Effect.succeed(null) // Fallback value
  })
)
```

### Retry Logic

```typescript
const program = pipe(
  oauth2Api.createClient(newClient),
  Effect.retry({
    times: 3,
    schedule: Effect.scheduleExponential('100 millis', 2.0),
  }),
  Effect.timeout('10 seconds')
)
```

### Using with Dependency Injection

```typescript
import { OAuth2ApiService } from './api/oauth2.js'
import { OAuth2ApiLayer } from './setup/hydra.js'

const program = pipe(
  OAuth2ApiService,
  Effect.flatMap((api) => api.getLoginRequest(challenge))
)

// Provide dependencies
const result = await Effect.runPromise(Effect.provide(program, OAuth2ApiLayer))
```

## API Methods

### Consent Flow

- `getConsentRequest(challenge)` - Get consent request details
- `acceptConsentRequest(challenge, body)` - Accept consent request
- `rejectConsentRequest(challenge, body)` - Reject consent request

### Login Flow

- `getLoginRequest(challenge)` - Get login request details
- `acceptLoginRequest(challenge, body)` - Accept login request
- `rejectLoginRequest(challenge, body)` - Reject login request

### Logout Flow

- `getLogoutRequest(challenge)` - Get logout request details
- `acceptLogoutRequest(challenge)` - Accept logout request
- `rejectLogoutRequest(challenge)` - Reject logout request

### Device Flow

- `deviceFlow()` - Initiate device authorization
- `acceptUserCodeRequest(challenge, body)` - Accept user code
- `performDeviceVerificationFlow()` - Perform device verification

### Client Management

- `createClient(client)` - Create new OAuth2 client
- `getClient(id)` - Get client by ID
- `listClients(params)` - List all clients (with pagination)
- `updateClient(id, client)` - Update client (PUT)
- `patchClient(id, patches)` - Patch client (PATCH)
- `deleteClient(id)` - Delete client
- `setClientLifespans(id, lifespans)` - Set token lifespans

### Token Management

- `introspectToken(token, scope?)` - Introspect access/refresh token
- `revokeToken(token, clientId?, clientSecret?)` - Revoke token
- `deleteTokens(clientId)` - Delete all tokens for client
- `tokenExchange(params)` - Exchange tokens (OAuth2 token endpoint)

### Session Management

- `listConsentSessions(params)` - List consent sessions
- `revokeConsentSessions(params)` - Revoke consent sessions
- `revokeLoginSessions(params)` - Revoke login sessions

### JWT Grant Issuers

- `trustJwtGrantIssuer(issuer)` - Create trusted JWT issuer
- `getTrustedJwtGrantIssuer(id)` - Get trusted issuer by ID
- `listTrustedJwtGrantIssuers(params)` - List trusted issuers
- `deleteTrustedJwtGrantIssuer(id)` - Delete trusted issuer

### Authorization

- `authorize()` - OAuth2 authorize endpoint

## Migration from @ory/client-fetch

### Before (Promise-based)

```typescript
import { OAuth2Api } from '@ory/hydra-client-fetch'

const client = new OAuth2Api(config)

try {
  const loginRequest = await client.getOAuth2LoginRequest({
    loginChallenge: challenge,
  })
  const redirect = await client.acceptOAuth2LoginRequest({
    loginChallenge: challenge,
    acceptOAuth2LoginRequest: { subject: 'user-123' },
  })
  return redirect.redirect_to
} catch (error) {
  console.error('Error:', error)
  throw error
}
```

### After (Effect-based)

```typescript
import { pipe, Effect } from 'effect'
import { oauth2Api } from './setup/hydra.js'

const program = pipe(
  oauth2Api.getLoginRequest(challenge),
  Effect.flatMap(() => oauth2Api.acceptLoginRequest(challenge, { subject: 'user-123' })),
  Effect.map((redirect) => redirect.redirect_to),
  Effect.catchAll((error) => {
    console.error('Error:', error)
    return Effect.fail(error)
  })
)

const result = await Effect.runPromise(program)
```

## Type Safety

All request and response types are imported from `@ory/client-fetch`, ensuring type compatibility with the official Ory SDK:

```typescript
import type {
  OAuth2LoginRequest,
  OAuth2ConsentRequest,
  OAuth2RedirectTo,
  OAuth2Client,
  // ... etc
} from '@ory/client-fetch'
```

## Testing

The Effect-based approach makes testing easier:

```typescript
// Create a mock service
const mockOAuth2Api: OAuth2ApiService = {
  getLoginRequest: (challenge) =>
    Effect.succeed({
      challenge,
      subject: 'test-user',
      // ... other fields
    }),
  // ... other methods
}

// Test with mock
const program = pipe(
  Effect.succeed(mockOAuth2Api),
  Effect.flatMap((api) => api.getLoginRequest('test-challenge'))
)

const result = await Effect.runPromise(program)
```

## Performance

- **Native fetch**: Uses Node's built-in fetch (Node 18+) - no additional dependencies
- **Parallel requests**: Use `Effect.all` for concurrent operations
- **Connection pooling**: Leverages fetch's connection pooling
- **No unnecessary abstractions**: Direct HTTP calls without SDK overhead

## Comparison with Effect's Built-in Service

This implementation uses Effect but doesn't use the full Effect service pattern from [src/fp/services/hydra.ts](../fp/services/hydra.ts). The key difference:

### This Implementation (oauth2.ts)

- Complete API coverage (30+ methods)
- Direct fetch calls
- Minimal abstractions
- Easier to understand and modify

### Effect Service Pattern (fp/services/hydra.ts)

- Subset of operations (only login/consent/logout)
- Full dependency injection with Context/Layer
- More functional composition
- Better for complex FP applications

Choose based on your needs:

- Use `oauth2.ts` for comprehensive API access with Effect error handling
- Use `fp/services/hydra.ts` for deep FP integration with full Effect patterns

## License

Same as the parent project.
