# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A headless OAuth2 login/consent provider that bridges **Ory Hydra** (OAuth2/OIDC server that supports Dynamic Client Registration) and **Google OAuth** (identity provider without DCR). It lets DCR-requiring clients such as Claude.ai MCP connectors authenticate against Google: clients register with Hydra, and all of them are funneled through a single Google client ID (`DCR_MASTER_CLIENT_ID`). Hydra client data lives in Postgres; PKCE state, auth codes and token data live in Redis; Express sessions live in Postgres (`connect-pg-simple`, table `session`).

Background docs: `OAUTH2_ARCHITECTURE.md` (flows, state, security), `AUTH_FLOW.md` (Claude connector setup, Hydra client config, discovery endpoints), `DEVELOPMENT.md`, `LINTING.md`, `README.test.md`.

## Commands

```bash
npm test                                   # vitest run (src/**/*.test.ts)
npx vitest run src/fp/services/redis.test.ts   # single test file
npx vitest run -t "test name"              # single test by name
npm run typecheck                          # tsc --noEmit
npm run lint / npm run lint:fix
npm run format / npm run format:check      # prettier on src/**
npm run validate                           # typecheck + lint + test
npm run build                              # clean, tsc, rollup -> dist/app-fp.js
npm run tswatch                            # tsc watch for compile errors only
npm run build && npm run serve:dev         # run locally against /etc/hydra-headless-ts/local.env
```

- Runtime scripts read env files from `/etc/hydra-headless-ts/*.env`. Of the `start:*`/`serve:*` scripts, only `serve` and `serve:dev` actually pass `--env-file`; the others set `NODE_ENV` to an `--env-file` string, so variables must already be exported. All of them run `dist/app-fp.js`, so build first. The `cli*` scripts read `src/env/*.env`; only `local.env` and `staging.env` are checked in.
- `docker-compose.yml` brings up Hydra (v25), its migration, Postgres, Redis and the app container; it mounts `/etc/hydra-headless-ts` (including `hydra.yml`) read-only.

## Architecture

**Entry point:** `src/app-fp.ts` (also the rollup input). It builds the Redis client, Google client and Hydra admin config, then calls `createAppLayer()` in `src/fp/bootstrap.ts`, which merges the Effect service layers (Redis, Google, JWT, OAuth2Api, legacy HydraService, logger). That single `serviceLayer` is passed into each router factory (`createXRouter(serviceLayer, config)`) in `src/routes/*-fp.ts`.

**Request flow** (see `OAUTH2_ARCHITECTURE.md` for the diagrams):
- `/oauth2/register` and `/oauth2/auth` are proxied straight to Hydra by `src/setup/proxy.ts`, which also captures the client's PKCE challenge into Redis on the way through.
- Hydra redirects to `/login` → `/consent`, which redirects the user to Google using the master Google client.
- Google returns to `/callback` (`REDIRECT_URL`), which exchanges the code, stores Google tokens in Redis, and completes the flow back to the original client.
- `/oauth2/token` (`routes/passthrough-auth-fp.ts` → `fp/services/token.ts`) handles `authorization_code` (validates PKCE against the stored state) and `refresh_token` grants. It issues JWTs (`fp/services/jwt.ts`, `JWT_PROVIDER` = `hydra` | `google`) rather than handing back Google's opaque tokens.
- `/device` implements the device authorization flow, `/logout` handles RP-initiated logout, and `/validate-token` checks tokens. The `cli-validate-token.ts` script does the same check from the CLI.

**Layering conventions:**
- Business logic lives in `src/fp/services/*.ts` as `Effect.gen` programs that pull dependencies from context (`yield* RedisService`). Each service exposes a `Context` tag and a `*Live` Layer factory.
- Routes are thin. They parse the request, run the service program with `Effect.provide(serviceLayer)` and `Effect.runPromise`, and map tagged errors to HTTP status codes in a per-route `mapErrorToHttp`.
- Errors are `Data.TaggedError` classes in `src/fp/errors.ts` (the `AppError` union); match on them by `_tag`.
- Runtime validation uses Effect Schema in `src/fp/domain.ts`. Redis reads are decoded through these schemas, e.g. `createOAuthRedisOps(redis).getAuthCode(code, Schema)`.
- Configuration: `src/fp/config.ts` defines everything with Effect `Config` (env vars such as `APP_ENV`, `BASE_URL`, `HYDRA_PUBLIC_URL`, `HYDRA_ADMIN_HOST`, `REDIS_HOST`, `GOOGLE_CLIENT_ID`, `DCR_MASTER_CLIENT_ID`, `REDIRECT_URL`, `JWT_*`). `src/config.ts` loads it synchronously into `appConfig` and adds flattened legacy aliases (`hydraInternalAdmin`, `redisHost`, …). To add a new env var, add it to `fp/config.ts` and the `src/env/*.env` files.
- Views are `@kitajs/html` TSX in `src/views/` (JSX factory `Html.createElement`, configured in tsconfig), not Pug. CSRF uses the `csrf-csrf` double-submit cookie pattern (`doubleCsrfProtection` from `src/setup/index.ts`).
- Logging goes through Effect's logger (`src/logging-effect.ts`). Use `syncLogger` outside Effect code.

**Legacy/stale code to be aware of:**
- `src/fp/types.ts` and `src/fp/environment.ts` are left over from an earlier fp-ts/io-ts `ReaderTaskEither` design and nothing imports them. The live code uses Effect (see `src/fp/README.md`).
- Non-`-fp` files such as `src/routes/index.ts` and `src/logging.ts` are older versions that `app-fp.ts` does not wire up.

## Style

- Prettier: no semicolons, single quotes, 100-column width, trailing commas (es5).
- ESM with `module: nodenext`, so relative imports must use the `.js` extension, even from `.ts` files.
- ESLint enforces import order, `consistent-type-imports` and `no-floating-promises`, and includes `eslint-plugin-functional`.

## Deployment notes

- The app is designed to run behind a proxy (developed behind HAProxy → Nginx → app; see `build/support_files/nginx/hydra.conf`, which needs a `private_ip` variable). Local dev runs without HTTPS. Set `MOCK_TLS_TERMINATION` to send `X-Forwarded-Proto: https` to Hydra.
- The README's open TODOs: install docs still rely on Salt (`build/hydra_pillar.yml`), and the code still assumes the upstream provider is Google.
