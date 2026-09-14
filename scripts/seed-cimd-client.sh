#!/usr/bin/env bash
# Pre-seed a CIMD (Client ID Metadata Document) client directly into Hydra's
# client store, for a fresh database/environment.
#
# Normally a CIMD client needs no seeding at all: the first /oauth2/auth
# request for it makes setup/proxy.ts's runCimdPipeline fetch the metadata
# document at the client_id URL and shadow-register it into Hydra via
# upsertCimdClient (see authFlow.ts, fp/services/cimd.ts). This script exists
# for the cases where you don't want to wait on that first live request:
#
#   * A fresh Postgres volume (`compose down -v`, or a brand-new environment)
#     has no client rows at all, and the very first login attempt against it
#     would otherwise 500 with Hydra's opaque "client not found" until a
#     CIMD-aware client happens to hit /oauth2/auth.
#   * CIMD_ENABLED is (temporarily) false on this host, or outbound network
#     access to fetch the real document isn't available yet, but you still
#     need the client registered to test the rest of the flow.
#
# Whatever this script writes is only a starting point -- once CIMD_ENABLED
# is true and a real request comes in, the app's own upsertCimdClient will
# reconcile it against the live document's content hash and correct any
# drift, so seeding stale/placeholder values here is safe.
#
# Defaults to Claude's published CIMD document
# (https://claude.ai/oauth/mcp-oauth-client-metadata, fetched 2026-09-14).
# Override the CIMD_* env vars below to seed a different CIMD client.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "${SCRIPT_DIR}/compose-env.sh"

command -v docker >/dev/null 2>&1 || { echo "error: docker is required" >&2; exit 2; }

CIMD_CLIENT_ID="${CIMD_CLIENT_ID:-https://claude.ai/oauth/mcp-oauth-client-metadata}"
CIMD_CLIENT_NAME="${CIMD_CLIENT_NAME:-Claude}"
CIMD_REDIRECT_URIS="${CIMD_REDIRECT_URIS:-https://claude.ai/api/mcp/auth_callback}"
CIMD_GRANT_TYPES="${CIMD_GRANT_TYPES:-authorization_code,refresh_token,urn:ietf:params:oauth:grant-type:jwt-bearer}"
CIMD_RESPONSE_TYPES="${CIMD_RESPONSE_TYPES:-code}"
CIMD_SCOPE="${CIMD_SCOPE:-openid email profile offline_access}"

if ! compose ps --status running --services 2>/dev/null | grep -qx hydra; then
  echo "error: the 'hydra' service is not running. Start it first:" >&2
  echo "  $DOCKER_CMD compose $COMPOSE_ARGS_STR up -d postgres hydra" >&2
  exit 1
fi

echo "Checking whether ${CIMD_CLIENT_ID} is already registered in Hydra ..."

if compose exec -T hydra hydra get oauth2-client "$CIMD_CLIENT_ID" \
  --endpoint http://127.0.0.1:4445 --format json >/dev/null 2>&1; then
  echo "Client already exists -- nothing to seed. To force-refresh it against"
  echo "the current CIMD_* defaults, delete it first:"
  echo "  $DOCKER_CMD compose $COMPOSE_ARGS_STR exec -T hydra hydra delete oauth2-client \"${CIMD_CLIENT_ID}\" --endpoint http://127.0.0.1:4445"
  exit 0
fi

echo "Seeding CIMD client ${CIMD_CLIENT_ID} ..."

out=$(compose exec -T hydra hydra create oauth2-client \
  --endpoint http://127.0.0.1:4445 \
  --id "$CIMD_CLIENT_ID" \
  --name "$CIMD_CLIENT_NAME" \
  --grant-type "$CIMD_GRANT_TYPES" \
  --response-type "$CIMD_RESPONSE_TYPES" \
  --token-endpoint-auth-method none \
  --scope "$CIMD_SCOPE" \
  --redirect-uri "$CIMD_REDIRECT_URIS" \
  --format json 2>&1)

if [ $? -ne 0 ] || ! printf '%s' "$out" | jq -e .client_id >/dev/null 2>&1; then
  echo "error: client creation failed:" >&2
  printf '%s\n' "$out" >&2
  exit 1
fi

printf '%s' "$out" | jq '{client_id, client_name, grant_types, response_types, scope, redirect_uris, token_endpoint_auth_method}'

cat <<EOF

Seeded. This client needs no AUTH_FLOW_CLIENT_ID/env wiring -- unlike the
DCR master client from dev-register-client.sh, a CIMD client is looked up
by the URL it already presents as client_id.

Verify with:
  $DOCKER_CMD compose $COMPOSE_ARGS_STR exec -T hydra hydra get oauth2-client "${CIMD_CLIENT_ID}" --endpoint http://127.0.0.1:4445
EOF
