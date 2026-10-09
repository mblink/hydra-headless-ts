# Development Guide

Complete guide for developing, testing, and maintaining the hydra-headless-ts project.

## Quick Start

```bash
# Install dependencies
npm install

# Build, then run against /etc/hydra-headless-ts/local.env
npm run build && npm run serve:dev

# Run tests
npm test

# Run linter
npm run lint

# Full validation (typecheck + lint + test)
npm run validate
```

## Project Structure

```text
hydra-headless-ts/
├── src/
│   ├── fp/                      # Functional programming modules
│   │   ├── config.ts            # Effect-based configuration
│   │   ├── domain.ts            # Effect Schema types
│   │   ├── validation.ts        # Pure validation (PKCE, scopes, schemas)
│   │   ├── bootstrap.ts         # Service layer composition
│   │   ├── services/            # Effect services
│   │   │   ├── redis.ts         # Redis service
│   │   │   ├── hydra.ts         # Hydra OAuth2 API service
│   │   │   ├── google.ts        # Google OAuth service
│   │   │   ├── jwt.ts           # JWT issuing/verification
│   │   │   ├── token.ts         # /oauth2/token grant handling
│   │   │   ├── login.ts, consent.ts, callback.ts, logout.ts
│   │   │   └── *.test.ts        # Service tests
│   │   └── errors.ts            # Tagged error types
│   ├── routes/                  # Express route handlers (*-fp.ts)
│   ├── views/                   # @kitajs/html TSX templates
│   ├── setup/                   # Hydra proxy, CSRF, Hydra API layer
│   ├── api/                     # API clients
│   ├── env/                     # Example env files used by the CLI scripts
│   │   ├── local.env
│   │   └── staging.env
│   └── app-fp.ts                # Main application entry point
├── vitest.config.ts             # Test configuration
├── eslint.config.js             # Linting configuration
├── tsconfig.json                # TypeScript configuration
└── package.json                 # Dependencies and scripts
```

## Environment Configuration

All configuration is read from environment variables by `src/fp/config.ts` (Effect `Config`). `APP_ENV` selects the environment (`local`, `development`, `staging` or `production`, default `local`).

The server scripts read env files from `/etc/hydra-headless-ts/`, not from the repository:

| Script | Env file |
| --- | --- |
| `npm run serve:dev` | `/etc/hydra-headless-ts/local.env` |
| `npm run serve` | `/etc/hydra-headless-ts/staging.env` |
| `npm run validate-token[:staging\|:production]` | `/etc/hydra-headless-ts/{local,staging,production}.env` |
| `docker compose up` | `/etc/hydra-headless-ts/hydra.env` |

The `cli`, `cli:staging` and `cli:production` scripts read `src/env/{local,staging,production}.env`. Only `local.env` and `staging.env` are checked in; use them as examples when creating the files under `/etc/hydra-headless-ts/`.

> **Note:** `start:local`, `start:staging`, `start:production`, `serve:local`, `serve:staging`, `serve:prod` and `serve:production` set `NODE_ENV='--env-file=...'` rather than passing `--env-file` to Node, so they do not load an env file. The variables must already be exported in the shell when you use these scripts.

All `start:*` and `serve:*` scripts run `dist/app-fp.js`, so run `npm run build` first.

## Development Workflow

### 1. Make Changes

Edit source files in `src/`. The project uses:

- **Effect** for functional programming
- **Effect Schema** for runtime validation
- **TypeScript** for type safety
- **Express** for HTTP server

### 2. Test Changes

```bash
# Run all tests
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# Coverage report
npm run test:coverage

# Interactive UI
npm run test:ui
```

### 3. Lint and Format

```bash
# Check formatting
npm run format:check

# Auto-format code
npm run format

# Run linter
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

### 4. Type Check

```bash
# Check TypeScript types
npm run typecheck
```

### 5. Full Validation

```bash
# Run everything (typecheck + lint + test)
npm run validate
```

## Testing

Comprehensive test suite covering all Effect-based services:

- **Unit Tests**: Individual service functions
- **Integration Tests**: Service layer composition
- **Schema Tests**: Runtime validation with Effect Schema

**Test Files**:

- `src/fp/config.test.ts` - Configuration service
- `src/fp/domain.test.ts` - Schema validation
- `src/fp/services/redis.test.ts` - Redis operations
- `src/fp/services/hydra.test.ts` - Hydra OAuth2 API
- `src/fp/services/google.test.ts` - Google OAuth
- `src/fp/bootstrap.test.ts` - Layer composition

See [README.test.md](README.test.md) for detailed testing documentation.

## Linting

The project follows TypeScript and functional programming best practices:

- **ESLint 10** with flat config
- **TypeScript ESLint** for type-aware linting
- **Import order** enforcement
- **Functional programming** patterns

See [LINTING.md](LINTING.md) for detailed linting documentation.

## Building

```bash
# Clean build artifacts
npm run clean

# Build TypeScript
npm run build

# Watch mode (rebuild on changes)
npm run tswatch
```

Build outputs:

- `dist/` - Compiled JavaScript
- `lib/` - Package distribution

`npm run build` lints, checks formatting and type checks before bundling, and fails on any of them; see [What fails CI and the build](LINTING.md#what-fails-ci-and-the-build).

## CI

- Woodpecker (`.woodpecker.yml`) is the only CI: `npm run ci`, then the Docker image build and push to ECR, then an email to the commit author on failure. There is no GitHub Actions workflow.
- To find out why a pipeline failed from the command line, see the `woodpecker-ci` skill (`.claude/skills/woodpecker-ci/SKILL.md`).
- Woodpecker runs for pushes to `RC` and PRs whose base is `RC`. A PR stacked on another branch gets no checks until it is retargeted to `RC`.
- PR pipelines run only the tests. The image build and push (`build-and-push`, `when: event: push`) runs only for pushes to `RC`, because a push also moves `:latest`, which deployed hosts pull. So a broken `build/Dockerfile.headless-ts` or an `npm ci` that fails inside the image shows up only after the merge, as a failed `RC` pipeline with a green PR behind it. Run `build/rebuild.sh` locally before merging a change to the image build.
- The CI image's `/node_modules` is installed from `RC`'s `package.json` when the image is built, so the test step runs `npm ci` first to test a PR's own dependencies from its `package-lock.json`.
- The app image fetches the exact commit being built: `build/rebuild.sh` exports `GIT_SHA` and the Dockerfile fetches that commit from GitHub, rather than copying the checkout. It used to `git clone --branch RC`, and BuildKit caches a `RUN` by its text, so the agent reused one stale clone for every build: images were tagged with new SHAs but held old code (see [STAGING_TROUBLESHOOTING.md](STAGING_TROUBLESHOOTING.md#docker-compose)). Keep the commit in that `RUN`'s cache key if you change it.

## Running the Application

### Development Mode

```bash
# Rebuild on change (compile errors only)
npm run tswatch

# Build and run against /etc/hydra-headless-ts/local.env
npm run build && npm run serve:dev
```

### Docker

```bash
# Hydra, Postgres, Redis and the app (expects /etc/hydra-headless-ts/{hydra.env,hydra.yml})
docker compose up
```

> **Follow-up/cleanup TODO:** `serve:staging`/`serve:production` set
> `NODE_ENV='--env-file=/etc/hydra-headless-ts/hydra.env'` — that's a stray
> flag string assigned to the wrong variable, not a real mechanism for
> loading the file. It's currently harmless: `docker-compose.yml` already
> injects `hydra.env` via its own `env_file:` directive, so the container's
> process env is correct regardless. But it's confusing to read and worth
> removing in a small follow-up PR rather than leaving it to look load-bearing.

## Effect Patterns

The codebase uses Effect for functional programming:

### Services

```typescript
import { Effect, Layer, Context } from 'effect'

export interface MyService {
  readonly operation: (input: string) => Effect.Effect<Result, Error>
}

export const MyService = Context.GenericTag<MyService>('MyService')

export const MyServiceLive = Layer.succeed(
  MyService,
  makeMyService()
)
```

### Using Services

```typescript
const program = Effect.gen(function* () {
  const service = yield* MyService
  const result = yield* service.operation('input')
  return result
})

// Provide dependencies
const runnable = Effect.provide(program, MyServiceLive)

// Execute
const result = await Effect.runPromise(runnable)
```

### Error Handling

```typescript
const program = Effect.gen(function* () {
  const result = yield* riskyOperation
  return result
})

// Handle errors
const result = await Effect.runPromise(
  Effect.either(program)
)

if (result._tag === 'Left') {
  console.error('Error:', result.left)
} else {
  console.log('Success:', result.right)
}
```

## Common Tasks

### Add a New Service

1. Create service interface in `src/fp/services/myservice.ts`:

```typescript
export interface MyService {
  readonly operation: (input: string) => Effect.Effect<Result, Error>
}

export const MyService = Context.GenericTag<MyService>('MyService')
```

- Create service implementation:

  ```typescript
  export const makeMyService = (): MyService => ({
    operation: (input) => Effect.succeed(result)
  })

  export const MyServiceLive = Layer.succeed(MyService, makeMyService())
  ```

- Add to bootstrap in `src/fp/bootstrap.ts`:

```typescript
const myServiceLayer = MyServiceLive()
return Layer.mergeAll(existingLayers, myServiceLayer)
```

- Write tests in `src/fp/services/myservice.test.ts`

### Add a New Route

- Create route handler in `src/routes/myroute-fp.ts`
- Use services via Effect:

```typescript
const program = Effect.gen(function* () {
  const service = yield* MyService
  return yield* service.operation(input)
})

const result = await Effect.runPromise(
  Effect.provide(program, serviceLayer)
)
```

- Register route in `src/app-fp.ts`

### Add Environment Variable

- Add to `src/env/*.env` files:

```bash
MY_VARIABLE=value
```

- Add to config schema in `src/fp/config.ts`:

```typescript
const myVariableConfig = Config.string('MY_VARIABLE')
  .pipe(Config.withDefault('default-value'))
```

- Add to AppConfig interface:

```typescript
export interface AppConfig {
  readonly myVariable: string
  // ... other config
}
```

## Troubleshooting

### Tests Failing

```bash
# Clear test cache
rm -rf node_modules/.vitest

# Re-run tests
npm test
```

### TypeScript Errors

```bash
# Rebuild
npm run clean && npm run build

# Check types
npm run typecheck
```

### Linting Issues

```bash
# Auto-fix
npm run lint:fix

# Format code
npm run format
```

### Environment Issues

- Check the env file under `/etc/hydra-headless-ts/` exists for the script you are running (see [Environment Configuration](#environment-configuration))
- Verify required variables are set (`BASE_URL`, `HYDRA_PUBLIC_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, ...)
- Check `APP_ENV` is one of `local`, `development`, `staging`, `production`

## Resources

- [Effect Documentation](https://effect.website/)
- [TypeScript Documentation](https://www.typescriptlang.org/)
- [ESLint Documentation](https://eslint.org/)
- [Vitest Documentation](https://vitest.dev/)
- [Express Documentation](https://expressjs.com/)

## Contributing

1. Create a feature branch
2. Make changes
3. Run `npm run validate` to ensure quality
4. Commit with descriptive message
5. Create pull request

### Git Workflow

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes and test
npm run validate

# Commit
git add .
git commit -m "feat: add my feature"

# Push
git push origin feature/my-feature
```

### Reformatting commits and `git blame`

Bulk reformat commits are listed in `.git-blame-ignore-revs`. Run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone so `git blame` skips them (GitHub's blame view reads the file automatically). Merge a PR that adds an entry with a merge commit, not squash or rebase: those create new hashes, and the listed ones stop matching.
