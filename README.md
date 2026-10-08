# Overview

This service implements a **headless OAuth2 login/consent provider** that bridges Ory Hydra (OAuth2 server with DCR) and Google OAuth (identity provider without DCR support).

## TLDR

This can be used as a connector in an AI Agent like Claude.ai that requires DCR, which Google doesn't support. The code uses Ory Hydra as
a OpenID Connect provider and Google as the OAuth Provider, routing a single client_id to your Google endpoint and keeping all of the client information
local in a PostGres DB, and using Redis for caching and sessions.

The underlying code originated from https://github.com/ory/hydra-login-consent-node, yet was completely modified to be written in typescript and only
the API calls.

### TODO

  Installation/documentation still depends on salt, which is fine if it can be dockerized
  Assumption that OAuth provider is google needs to be removed
  Likely More


In words, I could not write myself:
[Detailed breakdown of this OAuth2 flow](OAUTH2_ARCHITECTURE.md)

## Localhost vs Proxy

The code is written to run behind a proxy, or directly. It was developed behind HAProxy -> Nginx -> App.
Local development does not enable https

## Development Helpers

- [Dev Overview of Repository](./DEVELOPMENT.md)
- [Linting](./LINTING.md)
- [Quality Baseline](./QUALITY_BASELINE.md)
- [Unit Tests](./README.test.md)

### Running Locally

To run this locally,

Simply change into the root of the repository:

- Copy [src/env/local.env](src/env/local.env) to `/etc/hydra-headless-ts/local.env` and update the settings
- Run only watching compile errors `npm run tswatch`
- Launch the application `npm run build && npm run serve:dev` (reads `/etc/hydra-headless-ts/local.env`)

## Installing Docker Environment

- TODO

### Nginx Configuration

[Virtual Host configuration](build/support_files/nginx/hydra.conf), for Nginx.

- A single variable `private_ip` is required to speak to the upstream docker containers
