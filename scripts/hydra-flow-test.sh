#!/usr/bin/env bash
# Run `npm run test:hydra` (src/test/auth-flow.hydra.test.ts) against a throwaway Hydra in Docker.
# Same image and settings as the `hydra` service in .woodpecker.yml; keep the two in step.
# Hydra is published on 14444/14445 so it doesn't collide with a local dev Hydra on 4444/4445.
set -euo pipefail

IMAGE=${HYDRA_IMAGE:-oryd/hydra:v25.4.0-arm64}
NAME=hydra-flow-test-$$
APP_URL=http://127.0.0.1:3999

docker run -d --rm --name "$NAME" -p 127.0.0.1:14444:4444 -p 127.0.0.1:14445:4445 \
  -e DSN=memory \
  -e SECRETS_SYSTEM=hydra-flow-test-secret-not-for-production \
  -e OIDC_DYNAMIC_CLIENT_REGISTRATION_ENABLED=true \
  -e URLS_SELF_ISSUER=$APP_URL \
  -e URLS_SELF_PUBLIC=$APP_URL \
  -e URLS_LOGIN=$APP_URL/login \
  -e URLS_CONSENT=$APP_URL/consent \
  "$IMAGE" serve all --dev >/dev/null
trap 'docker logs "$NAME" > "${TMPDIR:-/tmp}/hydra-flow-test.log" 2>&1; docker rm -f "$NAME" >/dev/null' EXIT

HYDRA_E2E_HOST=127.0.0.1 HYDRA_E2E_PUBLIC_PORT=14444 HYDRA_E2E_ADMIN_PORT=14445 HYDRA_E2E_APP_URL=$APP_URL \
  LOG_DIR=${LOG_DIR:-${TMPDIR:-/tmp}} npm run test:hydra
