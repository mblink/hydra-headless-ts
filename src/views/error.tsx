import Html from '@kitajs/html';
import { Layout } from './components/Layout.js';

/**
 * OAuth2 Error Page
 *
 * Generic error page for OAuth2 flow failures. Displays user-friendly
 * error messages while optionally showing stack traces in development.
 *
 * Common OAuth2 Errors:
 * - invalid_request: Malformed OAuth2 request
 * - unauthorized_client: Client not authorized for this flow
 * - access_denied: User denied authorization
 * - invalid_scope: Requested scope is invalid/unknown
 * - server_error: Internal Hydra or Google OAuth error
 * - temporarily_unavailable: Service temporarily down
 *
 * Bridge Errors:
 * - PKCE validation failures
 * - Google token exchange failures
 * - Redis session storage errors
 * - Hydra API communication errors
 *
 * @see src/fp/errors.ts - AppError type definitions
 * @see src/app-fp.ts - Error handler middleware
 */
export interface ErrorProps {
  /** User-friendly error message */
  message: string;
  /** Stack trace (only shown in development environment) */
  stack?: string;
}

export function ErrorPage({ message, stack }: ErrorProps): string {
  return Layout({
    title: 'Error',
    children: (
      <>
        <h1>An error occurred</h1>
        <h2>{message}</h2>
        {stack && (
          <pre>
            <code>{stack}</code>
          </pre>
        )}
      </>
    ),
  });
}
