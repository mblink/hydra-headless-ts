import Html from '@kitajs/html';
import { Layout } from './components/Layout.js';

/**
 * OAuth2 Callback Handler - Google OAuth Bridge
 *
 * This template displays the callback URL after Google OAuth authentication.
 * Serves as a bridge between Google's OAuth2 provider and Hydra's OAuth2 server.
 *
 * Flow Context:
 * 1. User authenticates with Google OAuth
 * 2. Google redirects back to this callback with authorization code
 * 3. Backend exchanges code for Google tokens (access_token, id_token)
 * 4. Backend stores tokens in Redis with PKCE state
 * 5. User is redirected to complete Hydra's login/consent flow
 *
 * DCR Bridge Implementation:
 * - Google doesn't support Dynamic Client Registration
 * - This callback manages the Google OAuth client credentials
 * - Bridges Google's OAuth response to Hydra's login acceptance
 *
 * @see src/routes/callback-fp.ts - Callback handler using Effect
 * @see src/fp/services/callback.ts - Token exchange and validation
 */
export interface CallbackProps {
  /** The redirect URL where user will be sent after callback processing */
  url: string;
}

export function Callback({ url }: CallbackProps): string {
  return Layout({
    title: 'Callback',
    children: (
      <>
        <h1>Callback URL</h1>
        <p>
          <code>{url}</code>
        </p>
      </>
    ),
  });
}
