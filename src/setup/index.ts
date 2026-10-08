import * as crypto from 'crypto'
import { doubleCsrf, type CsrfTokenGenerator } from 'csrf-csrf'
import { appConfig } from '../config.js'

const { doubleCsrfProtection, generateCsrfToken: generateBoundCsrfToken } = doubleCsrf({
  getSecret: () => appConfig.security.cookieSecret,
  cookieName: appConfig.security.csrfTokenName,
  cookieOptions: {
    sameSite: appConfig.sameSite,
    httpOnly: appConfig.httpOnly,
    secure: appConfig.secure,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
  getSessionIdentifier: (req) => {
    return req.session.id
  },
  // Forms submit the token in a hidden field named after xsrfHeaderName (see views/*.tsx);
  // also accept the library's default header for non-form clients
  getCsrfTokenFromRequest: (req) => {
    const fromForm = (req.body as Record<string, unknown> | undefined)?.[
      appConfig.security.xsrfHeaderName
    ]
    if (typeof fromForm === 'string') {
      return fromForm
    }
    // A repeated header arrives as string[]; treat it as missing so validation fails cleanly
    const fromHeader = req.headers['x-csrf-token']
    return typeof fromHeader === 'string' ? fromHeader : undefined
  },
  // CSRF protection is applied selectively to routes with forms (logout, device/verify)
  // All other routes (including POST /) are not protected
})

/**
 * Generate a CSRF token bound to the current session.
 *
 * app-fp.ts uses `saveUninitialized: false`, so a session nothing has written to is never
 * saved and no session cookie is sent. The form POST would then arrive with a new session id
 * and fail validation. Writing to the session here makes express-session persist it.
 */
const generateCsrfToken: CsrfTokenGenerator = (req, res, options) => {
  req.session.csrfIssuedAt = Date.now()
  return generateBoundCsrfToken(req, res, options)
}

function validatePKCE(verifier: string, challenge: string, challengeMethod: string) {
  if (challengeMethod !== 'S256') {
    return false
  }

  const hash = crypto.createHash('sha256').update(verifier).digest()

  const computedChallenge = hash
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  return computedChallenge === challenge
}

interface RedisPKCE {
  code_challenge: string
  code_challenge_method: string
  scope: string
  state: string
  redirect_uri: string
  client_id: string
  timestamp: number
}
interface RedisRefreshToken {
  client_id: string
  refresh_token: string
  access_token: string
  scope: string
  subject: string
  created_at: number
  expires_in: number
}
interface GoogleTokenResponse {
  access_token: string
  expires_in: number
  scope: string
  token_type: string
  id_token: string | undefined // depending on the requested scopes and flow
  refresh_token: string | undefined // if a refresh token is issued
}
function base64URLEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
export { doubleCsrfProtection, generateCsrfToken, validatePKCE, base64URLEncode }
export type { RedisPKCE, RedisRefreshToken, GoogleTokenResponse }

// const configureCSRF = (app: express.Application) => {
//   app.use(doubleCsrfProtection);
//   app.use((req, res, next) => {
//     res.locals.csrfToken = generateCsrfToken(req, res);
//     next();
//   });
// };

// export {configureCSRF}
