import Html from '@kitajs/html';
import { Layout } from './components/Layout.js';

/**
 * OAuth2 Login Flow - Step 1: Authentication
 *
 * This template renders the login page in the OAuth2 authorization flow.
 * It bridges between Hydra (OAuth2 server with DCR support) and Google OAuth
 * (OAuth2 provider without DCR support).
 *
 * Flow Context:
 * 1. User initiates OAuth2 flow with a client application
 * 2. Client redirects to Hydra's /oauth2/auth endpoint
 * 3. Hydra redirects to this login page with a login_challenge
 * 4. User authenticates via Google OAuth (handled by passthrough-auth)
 * 5. Upon success, Hydra issues tokens to the client
 *
 * @see src/routes/login-fp.ts - Login handler using Effect
 * @see src/fp/services/login.ts - Login business logic
 */
export interface LoginProps {
  /** POST endpoint for login form submission */
  action: string;
  /** XSRF token header name for CSRF protection */
  envXsrfToken: string;
  /** CSRF token value */
  csrfToken: string;
  /** Hydra's login challenge identifying this OAuth2 flow */
  challenge: string;
  /** Email hint from OAuth2 request (login_hint parameter) */
  hint?: string;
  /** Error message if authentication failed */
  error?: string;
}

export function Login({ action, envXsrfToken, csrfToken, challenge, hint = '', error }: LoginProps): string {
  return Layout({
    title: 'Login',
    children: (
      <>
        <h1 id="login-title">Please log in</h1>
        {error && <p>{error}</p>}
        <form action={action} method="POST">
          <input type="hidden" name={envXsrfToken} value={csrfToken} />
          <input type="hidden" name="challenge" value={challenge} />
          <table>
            <tr>
              <td>
                <input type="email" id="email" name="email" value={hint} placeholder="email@foobar.com" />
              </td>
              <td>(it's "foo@bar.com")</td>
            </tr>
            <tr>
              <td>
                <input type="password" id="password" name="password" />
              </td>
              <td>(it's "foobar")</td>
            </tr>
          </table>
          <input type="checkbox" id="remember" name="remember" value="1" />
          <label for="remember">Remember me</label>
          <br />
          <input type="submit" id="accept" name="submit" value="Log in" />
          <input type="submit" id="reject" name="submit" value="Deny access" />
        </form>
      </>
    ),
  });
}
