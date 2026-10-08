import * as crypto from 'crypto';
import { doubleCsrf } from "csrf-csrf";
import { appConfig } from "../config.js";



const {
  doubleCsrfProtection, // The middleware to protect routes
  generateCsrfToken,        // Helper function to generate a CSRF token
} = doubleCsrf({
  getSecret: () => "G6KaOf8aJsLagw566he8yxOTTO3tInKD",
  cookieName: appConfig.csrfTokenName,
  cookieOptions: {
    // The forms post to this site, so Lax is enough; browsers reject SameSite=None without Secure
    sameSite: 'lax',
    httpOnly: true,
    secure: appConfig.secure,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
  getSessionIdentifier: (req) => {
    return req.session.id
  },
  // CSRF protection is applied selectively to routes with forms (logout, device/verify)
  // All other routes (including POST /) are not protected
});

function validatePKCE(verifier:string, challenge:string, challengeMethod:string) {
  if (challengeMethod !== 'S256') {
    return false;
  }

  const hash = crypto
    .createHash('sha256')
    .update(verifier)
    .digest();

  const computedChallenge = hash
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return computedChallenge === challenge;
}

interface RedisPKCE {
  code_challenge:string
  code_challenge_method:string
  scope: string
  state: string
  redirect_uri: string
  client_id: string
  timestamp:number
}
interface RedisRefreshToken {
  client_id: string,
  refresh_token: string,
  access_token: string,
  scope: string,
  subject: string,
  created_at:number,
  expires_in:number
}
interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token: string | undefined; // depending on the requested scopes and flow
  refresh_token: string | undefined; // if a refresh token is issued
}
function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
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
