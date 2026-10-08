# Functional Core (Effect)

This directory holds the application's business logic, written with [Effect](https://effect.website/). Express routes in `src/routes/*-fp.ts` stay thin: they parse the request, run an Effect program from here, and map the result or error to an HTTP response.

## Directory Structure

```text
fp/
├── config.ts             # Effect Config: all env vars, validated (APP_ENV, BASE_URL, HYDRA_*, GOOGLE_*, JWT_*, ...)
├── domain.ts             # Effect Schema definitions (PKCE state, token grants, Google responses, Redis payloads)
├── errors.ts             # Data.TaggedError classes and the AppError union
├── validation.ts         # Pure validation: PKCE, scopes, validateSchema
├── bootstrap.ts          # createAppLayer(): merges all service layers
├── services/
│   ├── redis.ts          # RedisService + createOAuthRedisOps (typed OAuth key helpers)
│   ├── hydra.ts          # HydraService (Hydra admin API)
│   ├── google.ts         # GoogleOAuthService
│   ├── jwt.ts            # JWTService (provider: hydra | google)
│   ├── token.ts          # authorization_code / refresh_token grants
│   └── login.ts, consent.ts, callback.ts, logout.ts   # per-route flows
├── types.ts, environment.ts   # Legacy fp-ts types; not used by the app
└── example-integration.ts     # Example only
```

## Services

Each service is an interface, a `Context` tag, a `make*` constructor and a `*Live` layer factory:

```typescript
export interface RedisService {
  readonly get: (key: string) => Effect.Effect<string | null, RedisError>
  readonly getJSON: <A, I>(
    key: string,
    schema: Schema.Schema<A, I, never>
  ) => Effect.Effect<A, RedisError | SchemaValidationError>
  // ...
}

export const RedisService = Context.GenericTag<RedisService>('RedisService')
export const makeRedisService = (client: Redis): RedisService => ({ ... })
export const RedisServiceLive = (client: Redis) => Layer.succeed(RedisService, makeRedisService(client))
```

`bootstrap.ts` merges the Redis, Google, JWT, OAuth2Api, Hydra and logger layers into a single layer. `src/app-fp.ts` creates that layer once and passes it to every router factory.

## Business Logic

Programs are written with `Effect.gen` and get their dependencies from context. For example, in `services/token.ts`:

```typescript
export const processAuthCodeGrant = (
  grant: AuthCodeGrant
): Effect.Effect<OAuth2TokenResponse, AppError, RedisService | JWTService> =>
  Effect.gen(function* () {
    const redis = yield* RedisService
    const jwt = yield* JWTService
    const redisOps = createOAuthRedisOps(redis)

    const authData = yield* redisOps.getAuthCode(grant.code, AuthCodeDataSchema)
    // validate PKCE, store tokens, issue JWT ...
  })
```

Data read from Redis or from external APIs is decoded with the schemas in `domain.ts`. The code does not cast `JSON.parse` output.

## Running from a Route

```typescript
const result = await Effect.runPromise(
  pipe(processLogin(challenge, subject), Effect.either, Effect.provide(serviceLayer))
)

if (result._tag === 'Left') {
  const { status, message } = mapErrorToHttp(result.left)
  return res.status(status).send(message)
}
```

## Errors

Errors are tagged classes, so they can be matched exhaustively on `_tag`:

```typescript
export class RedisKeyNotFound extends Data.TaggedError('RedisKeyNotFound')<{ key: string }> {}

switch (error._tag) {
  case 'InvalidPKCE': ...
  case 'RedisKeyNotFound': ...
  case 'HttpStatusError': ...
}
```

Add new errors to `errors.ts` and include them in the `AppError` union.

## Testing

Tests live next to the code (`*.test.ts`) and run with Vitest (`npm test`). Provide a test layer, such as one built from a mocked ioredis client, in place of the live layer, then check both paths with `Effect.either`:

```typescript
const result = await Effect.runPromise(
  Effect.either(Effect.provide(program, RedisServiceLive(mockClient)))
)
expect(result._tag).toBe('Left')
```

See [README.test.md](../../README.test.md) for more.
