import Html from '@kitajs/html';
import { Layout } from './components/Layout.js';

/**
 * OAuth2 Logout Flow - Session Termination
 *
 * This template renders the logout confirmation page in the OAuth2 flow.
 * Handles RP-initiated logout (Relying Party initiated logout) as defined
 * in OpenID Connect specifications.
 *
 * Flow Context:
 * 1. Client application initiates logout via Hydra's /oauth2/sessions/logout
 * 2. Hydra redirects to this logout page with a logout_challenge
 * 3. User confirms logout decision
 * 4. Upon confirmation, terminates both Hydra and Google OAuth sessions
 *
 * Session Management:
 * - Revokes Hydra OAuth2 session
 * - Optionally revokes Google OAuth tokens
 * - Clears all authentication cookies
 *
 * @see src/routes/logout-fp.ts - Logout handler using Effect
 * @see src/fp/services/logout.ts - Logout business logic
 */
export interface LogoutProps {
  /** POST endpoint for logout form submission */
  action: string;
  /** XSRF token header name for CSRF protection */
  envXsrfToken: string;
  /** CSRF token value */
  csrfToken: string;
  /** Hydra's logout challenge identifying this session */
  challenge: string;
}

export function Logout({ action, envXsrfToken, csrfToken, challenge }: LogoutProps): string {
  return Layout({
    title: 'Logout',
    children: (
      <>
        <h1>Logout</h1>
        <p>Do you want to log out?</p>

        <form action={action} method="POST">
          <input type="hidden" name={envXsrfToken} value={csrfToken} />
          <input type="hidden" name="challenge" value={challenge} />

          <input type="submit" id="accept" name="submit" value="Yes" />
          <input type="submit" id="reject" name="submit" value="No" />
        </form>
      </>
    ),
  });
}
