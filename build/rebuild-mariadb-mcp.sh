#!/usr/bin/env bash
# Build the mariadb-mcp runtime image from oddjob's canonical Dockerfile, and
# (locally) recreate a running mariadb-mcp container against it.
#
#   rebuild-mariadb-mcp.sh              local: build, tag, and recreate
#                                       mariadb-mcp if it's already running
#   rebuild-mariadb-mcp.sh --build-only build and tag only -- used by
#                                       salt/mariadb-mcp/rebuild.sh (salt
#                                       repo), which stops/recreates every
#                                       instance itself around this
#   rebuild-mariadb-mcp.sh --push       also push the built image to ECR
#                                       (off by default: oddjob's own CI is
#                                       the intended publisher, see
#                                       oddjob/drone/build.sh)
#
# oddjob/drone/Dockerfile.mariadb-mcp is the single source for this image --
# docker-compose.yml's x-mariadb-mcp anchor has no `build:` of its own any
# more. mblink/oddjob is private, so getting that one file onto disk needs a
# PAT: the same one rebuild.sh already reads (GIT_TOKEN in the environment
# locally, or the bldeploy PAT file on a real host). That PAT is scoped for
# mblink/hydra-headless-ts today -- confirm it can also read mblink/oddjob
# before relying on this on a host that has never needed it.
set -eo pipefail

if [ "$(uname)" = "Darwin" ]; then
  export GIT_COMMAND=git
else
  export GIT_COMMAND="sudo -u bldeploy git"
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "${SCRIPT_DIR}/shared.sh"
COMPOSE_FILE="${SCRIPT_DIR}/../docker-compose.yml"

PUSH=0
BUILD_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    --build-only) BUILD_ONLY=1 ;;
    *)
      echo "error: unknown argument '$arg' (expected --push and/or --build-only)" >&2
      exit 1
      ;;
  esac
done

if [ -z "${GIT_TOKEN:-}" ]; then
  PAT_SRC="${PAT_SRC:-/var/bondlink/tmp/.github/bldeploy.pat}"
  if [ ! -r "$PAT_SRC" ]; then
    echo "error: no PAT available -- set GIT_TOKEN, or provide a readable file at $PAT_SRC" >&2
    ls -la "$(dirname "$PAT_SRC")" >&2 2>&1 || echo "error: $(dirname "$PAT_SRC") does not exist" >&2
    exit 1
  fi
  GIT_TOKEN="$(cat "$PAT_SRC")"
fi

# Ephemeral: this script's whole reason to clone oddjob is to read one file
# out of it, not to keep a checkout around. Written the same way rebuild.sh
# writes its own askpass script -- a file, not a build-arg or argv, since both
# of those are visible in `docker history`/`ps` for the life of the process.
GIT_ASKPASS_FILE="$(mktemp)"
CLONE_DIR="$(mktemp -d)"
trap 'rm -f "$GIT_ASKPASS_FILE"; rm -rf "$CLONE_DIR"' EXIT
cat > "$GIT_ASKPASS_FILE" <<EOF
#!/usr/bin/env bash
case "\$1" in
  Username*) echo "x-access-token" ;;
  *) echo "$GIT_TOKEN" ;;
esac
EOF
chmod 700 "$GIT_ASKPASS_FILE"

GIT_ASKPASS="$GIT_ASKPASS_FILE" GIT_TERMINAL_PROMPT=0 \
  git clone --depth 1 --branch master --single-branch https://github.com/mblink/oddjob.git "$CLONE_DIR"

# Read the target tag back from docker-compose.yml's own x-mariadb-mcp anchor
# rather than hardcoding a second copy of the ECR path/tag here -- one less
# place for this to drift from what `image:` actually says.
IMAGE="$(docker compose -f "$COMPOSE_FILE" config --images mariadb-mcp-base)"

set -x
docker build --pull -t "$IMAGE" -f "${CLONE_DIR}/drone/Dockerfile.mariadb-mcp" "${CLONE_DIR}/drone"
{ set +x; } 2>/dev/null

if [ $PUSH -eq 1 ]; then
  login
  docker push "$IMAGE"
fi

if [ $BUILD_ONLY -eq 1 ]; then
  exit 0
fi

# Local convenience only: recreate mariadb-mcp against the image just built,
# but only if it's already running -- a fresh dev checkout with nothing
# started yet shouldn't have this script also decide to start the stack.
running=$(docker ps --filter "name=mariadb-mcp" -q)
if [ -n "$running" ]; then
  docker compose -f "$COMPOSE_FILE" -f "${SCRIPT_DIR}/../docker-compose.mariadb-mcp.dev.yml" \
    up -d --force-recreate mariadb-mcp
fi
