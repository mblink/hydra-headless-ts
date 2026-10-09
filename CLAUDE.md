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
npm run knip                               # unused files, exports and dependencies
npm run ci                                 # what Woodpecker runs: lint, format:check, knip, tsc, tests
npm run validate                           # typecheck + lint + knip + test + nginx drift check
npm run build                              # lint, format:check, knip, tsc, rollup -> dist/app-fp.js
npm run tswatch                            # tsc watch for compile errors only
npm run build && npm run serve:dev         # run locally against /etc/hydra-headless-ts/local.env
```

- Runtime scripts read env files from `/etc/hydra-headless-ts/*.env`. `serve`, `serve:dev` and `start:*` pass `--env-file`; `serve:staging`/`serve:prod`/`serve:production` (what `build/entrypoint.sh` runs in the container) set `NODE_ENV=production` and expect the variables to be exported already. All of them run `dist/app-fp.js`, so build first. Outside `APP_ENV=local`, `SESSION_SECRET` and `COOKIE_SECRET` are required and the app exits without them. The `cli*` scripts read `src/env/*.env`; only `local.env` and `staging.env` are checked in.
- `docker-compose.yml` brings up Hydra (v25), its migration, Postgres, Redis and the app container; it mounts `/etc/hydra-headless-ts` (including `hydra.yml`) read-only.

## Architecture

**Entry point:** `src/app-fp.ts` (also the rollup input). It builds the Redis client, Google client and Hydra admin config, then calls `createAppLayer()` in `src/fp/bootstrap.ts`, which merges the Effect service layers (Redis, Google, JWT, OAuth2Api, legacy HydraService, logger). That single `serviceLayer` is passed into each router factory (`createXRouter(serviceLayer, config)`) in `src/routes/*-fp.ts`.

**Request flow** (see `OAUTH2_ARCHITECTURE.md` for the diagrams):
- `/oauth2/register` and `/oauth2/auth` are proxied to Hydra by `src/setup/proxy.ts`. Both reject redirect URIs outside `ALLOWED_REDIRECT_URIS` (plus loopback), since login and consent never prompt. For `/oauth2/auth` it validates the parameters (S256 PKCE only, each parameter given once) and CIMD clients when enabled, generates a random flow id, stores the client's PKCE challenge and the browser session id in Redis under it, and sends the flow id to Hydra as `state`.
- Hydra redirects to `/login` → `/consent`, which reads the flow id back from the consent request's `request_url` and redirects the user to Google with it as `state`, using the master Google client.
- Google returns to `/callback` (`REDIRECT_URL`), which looks the flow up by `state`, rejects it unless it belongs to the current browser session, exchanges the code, verifies Google's ID token (`email_verified` plus the email allowlist), stores the Google tokens and the Google `sub` as the subject in Redis, and completes the flow back to the original client.
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
- Unused files, exports and dependencies are checked by knip (`npm run knip`, also in CI). Entry points come from knip's rollup, vitest and package.json-script plugins.

## Style

- Prettier (`.prettierrc.json`, the only config): semicolons, single quotes, 120-column width, trailing commas everywhere, `objectWrap: "preserve"`. Bulk reformat commits are listed in `.git-blame-ignore-revs`.
- ESM with `module: nodenext`, so relative imports must use the `.js` extension, even from `.ts` files.
- ESLint 10 flat config with `eslint-plugin-import-x` (TypeScript resolver), enforcing import order, `consistent-type-imports` and `no-floating-promises`; also `eslint-plugin-functional`.
- Lint runs with `--max-warnings 0`, so `warn` rules fail too. `npm run ci` and `npm run build` fail on any lint, format, knip or type error, and Rollup fails on any warning except two allowlisted ones from bundled dependencies (see `LINTING.md`).
- CI: `RC` (the deployed branch) is tested and built by Woodpecker (`.woodpecker.yml`: `npm ci`, `npm run ci`, then the Docker image build); it runs only for pushes to `RC` and PRs based on `RC`. It is the only CI; there is no GitHub Actions workflow. `package-lock.json` is committed; install with `npm ci`.
- The rotating file logger writes to `LOG_DIR` (default `/var/log/hydra-headless-ts`); set `LOG_DIR` when that path isn't writable, e.g. running tests outside the server.

## Deployment notes

- The app is designed to run behind a proxy (developed behind HAProxy → Nginx → app; see `build/support_files/nginx/hydra.conf`, which needs a `private_ip` variable). Local dev runs without HTTPS. Set `MOCK_TLS_TERMINATION` to send `X-Forwarded-Proto: https` to Hydra.
- The README's open TODOs: install docs still rely on Salt (`build/hydra_pillar.yml`), and the code still assumes the upstream provider is Google.
