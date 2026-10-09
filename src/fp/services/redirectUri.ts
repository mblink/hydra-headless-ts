/**
 * Redirect URI policy for dynamically registered and CIMD clients.
 *
 * Anyone can register a client, and login and consent are accepted without a prompt, so the
 * redirect URI is the only thing deciding where an allowlisted user's authorization code goes.
 * Only exact configured URIs and (optionally) RFC 8252 loopback URIs are accepted.
 */
import type { RedirectUriPolicy } from '../config.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// RFC 8252 §7.3: a native app listens on a loopback port of its choosing, so any port and path
// is fine; a code sent there never leaves the user's machine
const isLoopbackRedirectUri = (uri: string): boolean => {
  if (!URL.canParse(uri)) return false;
  const url = new URL(uri);
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) && !url.username && !url.password;
};

export const isRedirectUriAllowed = (uri: string, policy: RedirectUriPolicy): boolean =>
  policy.allowed.includes(uri) || (policy.allowLoopback && isLoopbackRedirectUri(uri));

/**
 * The first entry of a registration request's `redirect_uris` that the policy rejects, or a
 * reason the field itself is unusable. `undefined` means every entry is allowed.
 */
export const findDisallowedRedirectUri = (redirectUris: unknown, policy: RedirectUriPolicy): string | undefined => {
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return 'redirect_uris must be a non-empty array';
  }
  const rejected = redirectUris.find((uri) => typeof uri !== 'string' || !isRedirectUriAllowed(uri, policy));
  return rejected === undefined ? undefined : `redirect_uri is not allowed: ${String(rejected)}`;
};
