---
name: woodpecker-ci
description: Find out why a Woodpecker pipeline for this repo failed, or wait for one to finish, by reading the step logs through the Woodpecker API. Use when given a woodpecker.bondlink.org pipeline URL, when a push to RC or a PR's check fails, or after pushing to RC.
---

# Woodpecker CI

Woodpecker (`.woodpecker.yml`) is this repo's only CI, at https://woodpecker.bondlink.org. It runs for pushes to `RC` and for PRs based on `RC`. What runs where (see `DEVELOPMENT.md` → CI):

| Step | PR | Push to `RC` |
|---|---|---|
| `clone`, `init-build`, `run-tests` (`npm ci`, `npm run ci`) | yes | yes |
| `build-and-push` (`build/rebuild.sh --ci`: image build, push to ECR, move `:latest`) | **no** | yes |
| `notify` (email on failure) | yes | yes |

A green PR therefore says nothing about the image build. A Dockerfile or in-image `npm ci` failure first shows up as a failed `RC` pipeline after the merge.

A pipeline URL looks like `https://woodpecker.bondlink.org/repos/5/pipeline/71/5`: repo id `5` (mblink/hydra-headless-ts), pipeline number `71`, and the step's `pid` `5`. The log API wants the step's `id`, not its `pid`.

## Setup

You need a personal API token, from the Woodpecker UI under your user settings. Export it as `WOODPECKER_TOKEN`, or on macOS keep it in the Keychain as a generic password with service `woodpecker.bondlink.org`. Never echo the token.

```bash
TOKEN=${WOODPECKER_TOKEN:-$(security find-generic-password -s woodpecker.bondlink.org -w)}
W=https://woodpecker.bondlink.org/api
api() { curl -fsS -H "Authorization: Bearer $TOKEN" "$W/$1"; }
```

## Why did a pipeline fail?

```bash
REPO=5 P=71   # from the URL; or look the repo up: api repos/lookup/mblink/hydra-headless-ts | jq .id

# Event, commit and every step's state; the failing step is the one with a non-zero exit_code
api repos/$REPO/pipelines/$P | jq '{event, branch, commit, status,
  steps: [.workflows[].children[] | {pid, id, name, state, exit_code}]}'

# The failed step's log. `data` is base64, so decode it with @base64d.
STEP_ID=$(api repos/$REPO/pipelines/$P | jq -r '[.workflows[].children[] | select(.state=="failure")][0].id')
api repos/$REPO/logs/$P/$STEP_ID | jq -r '.[].data | @base64d' > /tmp/step.log   # use your scratchpad dir
tail -80 /tmp/step.log
```

- The Docker build's output contains non-UTF-8 bytes, so use `grep -a` (and `LC_ALL=C` with `cut`/`sed`), or the tools stop with "binary file matches" or "Illegal byte sequence".
- Before you blame the newest commit, check whether the same step failed on earlier pipelines (`api "repos/$REPO/pipelines?per_page=20" | jq -r '.[] | "\(.number) \(.event) \(.status) \(.commit[0:7])"'`). A run of failed `push` pipelines behind green `pull_request` ones means the image build broke, and PRs never run it.
- In the image build, check which BuildKit steps say `CACHED`. A step that fetches something (git, npm, apk) and is `CACHED` didn't fetch anything new. See the image-build entry in `STAGING_TROUBLESHOOTING.md` → Docker Compose.

## Wait for a pipeline

To wait for the pipeline for a commit you just pushed, poll in the background (with `run_in_background`, not a foreground sleep):

```bash
SHA=$(git rev-parse --short HEAD)
for i in $(seq 1 80); do
  r=$(api "repos/5/pipelines?per_page=10" | jq -r --arg s "$SHA" '[.[] | select(.commit|startswith($s))][0] | "\(.number) \(.status)"')
  case "$r" in *success|*failure|*error|*killed) echo "$r"; break;; esac
  sleep 20
done
```

When it passes on `RC`, the `build-and-push` log ends with `Build and push complete: ...:<date>_hydra-headless-ts_<sha>` and `...:latest`. Deployed hosts don't pull the new image on their own. See the same `STAGING_TROUBLESHOOTING.md` entry for the pull and recreate steps.
