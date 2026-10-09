import { doubleCsrf, type CsrfTokenGenerator } from 'csrf-csrf';
import { appConfig } from '../config.js';

const { doubleCsrfProtection, generateCsrfToken: generateBoundCsrfToken } = doubleCsrf({
  getSecret: () => appConfig.security.cookieSecret,
  cookieName: appConfig.security.csrfTokenName,
  cookieOptions: {
    // The forms post to this site, so Lax is enough; browsers reject SameSite=None without Secure
    sameSite: 'lax',
    httpOnly: true,
    secure: appConfig.secure,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
  getSessionIdentifier: (req) => {
    return req.session.id;
  },
  // Forms submit the token in a hidden field named after xsrfHeaderName (see views/*.tsx);
  // also accept the library's default header for non-form clients
  getCsrfTokenFromRequest: (req) => {
    const fromForm = (req.body as Record<string, unknown> | undefined)?.[appConfig.security.xsrfHeaderName];
    if (typeof fromForm === 'string') {
      return fromForm;
    }
    // A repeated header arrives as string[]; treat it as missing so validation fails cleanly
    const fromHeader = req.headers['x-csrf-token'];
    return typeof fromHeader === 'string' ? fromHeader : undefined;
  },
  // CSRF protection is applied selectively to routes with forms (logout, device/verify)
  // All other routes (including POST /) are not protected
});

/**
 * Generate a CSRF token bound to the current session.
 *
 * app-fp.ts uses `saveUninitialized: false`, so a session nothing has written to is never
 * saved and no session cookie is sent. The form POST would then arrive with a new session id
 * and fail validation. Writing to the session here makes express-session persist it.
 */
const generateCsrfToken: CsrfTokenGenerator = (req, res, options) => {
  req.session.csrfIssuedAt = Date.now();
  return generateBoundCsrfToken(req, res, options);
};

export { doubleCsrfProtection, generateCsrfToken };
