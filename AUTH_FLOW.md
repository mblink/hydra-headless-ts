# Claude Oauth Flow

## Configuration

### Custom MCP Connector

- MCP Server endpoint: <https://auth.mycompany.tld>
- ClientID: From Google
- Redirect URI: <https://claude.ai/api/mcp/auth_callback>

Secrets are not saved in Claude, though it has the option, with this flow it makes no sense.

### Hydra client configuration

Further description to follow. Current client configuration, this client is a gateway to more DCR clients

Notes:

- Both redirect url's are registered as both will be target. This is equally important with Google's client and Hydras, since we'll handle `PKCE` validation
- Scopes of `offline && offline_access` are never sent to Google, You inform Google by `access_type` and drop the scope from request
- Every client must carry `CLIENT_SCOPE` (`openid email profile offline_access`, in `src/authFlow.ts`). Claude requests the scopes listed in the protected resource metadata (`db-tools.json`), and falls back to the authorization server's `scopes_supported` when that file is missing. `routes/discovery-fp.ts` replaces Hydra's own `scopes_supported` (which includes `offline`) with `CLIENT_SCOPE`, so the fallback asks for the same scopes. A requested scope the client doesn't carry fails at Hydra with `invalid_scope`.
- Hydra gives a DCR client registered without a `scope` the scope `offline_access offline openid`, which lacks `email` and `profile`. The `/oauth2/register` proxy fills in `CLIENT_SCOPE` when the request has none. `newClient` (CLI) and CIMD shadow clients use `CLIENT_SCOPE` too.
- `skip_consent` and `skip_login` are both set to false.  Here hydra normal Oauth flow is utilized to stick directly to the Authorization flow.
- `PKCE` Validation, while shown in the configuration with `RS256` is not being used, the application is validating PKCE tokens.
  - Hydra does not generate a `codeVerifier` for the incoming `code_challenge` and `state`.
    - That would be part of the `kratos` flow, and out of scope for Hydra
  - There may be a better client configuration, yet to be seen, there are no bugs in this config that imped progress.

```json
{
  "client_id": "a8c11f42-a9d7-4437-9b0b-cd48e25a71a5",
  "client_name": "",
  "client_secret_expires_at": 0,
  "client_uri": "",
  "created_at": "2025-10-17T20:09:02Z",
  "grant_types": [
    "authorization_code",
    "refresh_token"
  ],
  "jwks": {},
  "logo_uri": "",
  "metadata": {},
  "owner": "",
  "policy_uri": "",
  "redirect_uris": [
    "https://auth.mycompany.tld/callback",
    "https://claude.ai/api/mcp/auth_callback"
  ],
  "request_object_signing_alg": "RS256",
  "response_types": [
    "code",
    "id_token"
  ],
  "scope": "email profile openid offline offline_access",
  "skip_consent": false,
  "skip_logout_consent": false,
  "subject_type": "public",
  "token_endpoint_auth_method": "none",
  "tos_uri": "",
  "updated_at": "2025-10-28T14:21:42.383122Z",
  "userinfo_signed_response_alg": "none"
}
```

### Startup client verification (`ensureClient`)

`build/entrypoint.sh` runs `ensureClient()` (`src/authFlow.ts`) on every
container start to confirm the configured `AUTH_FLOW_CLIENT_ID` still exists
in Hydra. **On failure it does not just fail** — it first calls Hydra's admin
API and creates a brand-new throwaway client (`newClient('hydra-headless')`),
then exits 1. Combined with `restart: unless-stopped`, a stale
`AUTH_FLOW_CLIENT_ID` turns into a crash loop that mints a new orphaned OAuth2
client roughly every ~11s, indefinitely, until someone fixes the configured ID
— see `STAGING_TROUBLESHOOTING.md`'s OAuth section for the cleanup recipe.
`SKIP_CLIENT_CHECK=1` skips this entire check (including the throwaway-client
side effect) and should only be a temporary stopgap, never a standing prod
config.

## Discovery Endpoints

Claude was configured with https://auth.mycompany.tld

It then will probe this endpoint for the following:

- `/.well-known/oauth-protected-resource` is still a plain nginx redirect (static JSON, `build/nginx/www/auth/.well-known/oauth-protected-resource/`).
- `/.well-known/oauth-authorization-server` is **no longer** a blind nginx redirect straight to Hydra's own `/.well-known/openid-configuration`. It's composed by the app (`src/routes/discovery-fp.ts`): fetches Hydra's document server-side, and — when `CIMD_ENABLED=true` — merges in `client_id_metadata_document_supported: true` so CIMD-aware clients can auto-detect support. Everything Hydra publishes natively (`registration_endpoint`, `jwks_uri`, etc.) still passes through untouched; DCR keeps working exactly as described below.

This tells Claude the next urls of interest are:

- `Authorization` @ `https://auth.mycompany.tld/oauth2/auth`
  - This url is handled by utilizing [HTTP Proxy Middleware](https://www.npmjs.com/package/http-proxy-middleware). Registered with `app.user("/ouath2/token", proxyMiddleware)`
    - The registration must come after registering `express-session` and before any registration of a `body-parser`, the former is a helper, the latter can modify the body
    - [ProxyMiddleware](https://github.com/jeffdyke/hydra-headless-ts/blob/master/src/setup/proxy.ts)
      - This sets session data b/c the application would be otherwise skipped b/c of configuration within `/.well-known/openid-configuration`.
         All signs led to middleware, rather than modifying the autogenerated Oauth2 routes
- `Authentication` @ `https://auth.mycompany.tld/oauth2/token`
  - Hydra is no longer part of the flow here, see PKCE comments, middleware is not used, the application defines the entire route, two paths
  - [Called claude.ts currently](https://github.com/jeffdyke/hydra-login-headless-ts/blob/master/src/routes/claude.ts)
    - Unless changed this file will handle both `grant_type == authorization && grant_type == token_refresh`
      - Last bugs are in refresh token

Supporting code exists for both, especially `/oauth2/token` more forthcoming.

## The flow, leg by leg

The step-by-step walkthrough that used to be here described an earlier design: `state` was `req.session.id`, `/login` sent Google's URL, and `/consent` prompted. The current flow is in `OAUTH2_ARCHITECTURE.md` → "Authorization Code Flow with PKCE", as a table of every request from discovery to `/oauth2/token`, with the state each one reads and writes. Read it, and the checklist at its end, before changing anything on that path.
