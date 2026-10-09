import Html from '@kitajs/html';
import { Layout } from './components/Layout.js';

/**
 * OAuth2 Consent Flow - Step 2: Authorization
 *
 * This template renders the consent screen in the OAuth2 authorization flow.
 * After successful authentication, the user must authorize the client application
 * to access their resources with the requested scopes.
 *
 * Flow Context:
 * 1. User has successfully authenticated via Google OAuth
 * 2. Hydra redirects to this consent page with a consent_challenge
 * 3. User reviews requested OAuth2 scopes (openid, profile, email, etc.)
 * 4. User grants or denies authorization
 * 5. Upon grant, Hydra issues authorization code/tokens to client
 *
 * DCR Bridge:
 * - Hydra requires Dynamic Client Registration (DCR)
 * - Google OAuth doesn't support DCR
 * - This consent flow bridges the gap by managing client metadata
 *
 * @see src/routes/consent-fp.ts - Consent handler using Effect
 * @see src/fp/services/consent.ts - Consent business logic
 */
export interface ConsentProps {
  /** POST endpoint for consent form submission */
  action: string;
  /** XSRF token header name for CSRF protection */
  envXsrfToken: string;
  /** CSRF token value */
  csrfToken: string;
  /** Hydra's consent challenge identifying this OAuth2 flow */
  challenge: string;
  /** OAuth2 scopes requested by the client (e.g., openid, profile, email) */
  requestedScope?: string[];
  /** OAuth2 client metadata from Hydra */
  client?: {
    /** Client application name */
    client_name?: string;
    /** Privacy policy URL */
    policy_uri?: string;
    /** Terms of service URL */
    tos_uri?: string;
  };
}

export function Consent({
  action,
  envXsrfToken,
  csrfToken,
  challenge,
  requestedScope = [],
  client,
}: ConsentProps): string {
  return Layout({
    title: 'Authorize Application',
    children: (
      <>
        <h1>Authorize {client?.client_name ?? 'Application'}</h1>
        <p>
          Hi there! The application <strong>{client?.client_name ?? 'Unknown'}</strong> wants access to your data. The
          following permissions are requested:
        </p>

        {requestedScope.length > 0 && (
          <ul id="scopes">
            {requestedScope.map((scope) => (
              <li>{scope}</li>
            ))}
          </ul>
        )}

        <p>Do you want to grant these permissions?</p>

        <form action={action} method="POST">
          <input type="hidden" name={envXsrfToken} value={csrfToken} />
          <input type="hidden" name="challenge" value={challenge} />

          <input type="checkbox" id="remember" name="remember" value="1" />
          <label for="remember">Remember this decision</label>
          <br />

          <input type="submit" id="accept" name="submit" value="Allow access" />
          <input type="submit" id="reject" name="submit" value="Deny access" />
        </form>

        {client?.policy_uri && (
          <p>
            <a href={client.policy_uri}>Privacy Policy</a>
          </p>
        )}
        {client?.tos_uri && (
          <p>
            <a href={client.tos_uri}>Terms of Service</a>
          </p>
        )}
      </>
    ),
  });
}
