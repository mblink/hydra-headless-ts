import Html from '@kitajs/html'
import { Layout } from './components/Layout.js'

/**
 * OAuth2 Authorization Server Landing Page
 *
 * Information page for the OAuth2 authorization server that bridges
 * Hydra (with DCR support) and Google OAuth (without DCR support).
 *
 * Architecture:
 * - Ory Hydra: OAuth2 & OpenID Connect server (requires DCR)
 * - Google OAuth: Identity provider (no DCR support)
 * - This service: Headless login/consent provider bridging the gap
 *
 * Supported Flows:
 * - Authorization Code Flow (with PKCE)
 * - Device Authorization Flow (RFC 8628)
 * - Token Refresh Flow
 * - Logout Flow
 *
 * Technology Stack:
 * - Effect-ts: Functional effects system
 * - Redis: Session and PKCE state storage
 * - TypeScript: Type-safe implementation
 *
 * @see https://www.ory.sh/hydra/docs/
 * @see https://datatracker.ietf.org/doc/html/rfc7591 (DCR spec)
 */
export interface IndexProps {
  /** Page title */
  title?: string
}

export function Index({ title = 'OAuth 2.0 & OpenID Connect' }: IndexProps): string {
  return Layout({
    title,
    children: (
      <>
        <h1>{title}</h1>
        <p>
          This is the login & consent provider for the OAuth 2.0 Authorization Server powered by Ory
          Hydra.
        </p>
        <p>
          <strong>Architecture:</strong> Bridges Hydra (with DCR support) and Google OAuth (without
          DCR support) using a functional, type-safe Effect-ts implementation.
        </p>
      </>
    ),
  })
}
