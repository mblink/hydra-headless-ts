/**
 * Keeps credentials out of the logs. Every log entry is serialized with `redactingReplacer`, so a
 * call site that logs a request body, headers, an error or a Redis value can't leak what it holds.
 */

export const REDACTED = '[REDACTED]';

// Matched against the property name: access/refresh/ID tokens and the Google copies, auth codes,
// PKCE verifiers, client secrets, Cookie/Authorization headers, CSRF tokens, token previews, and
// the raw Redis JSON that RedisParseError carries
const SENSITIVE_KEY =
  /(token|secret|password|verifier|authorization|cookie|_preview)$|^(code|authcode|auth_code|raw)$/i;

// The same values in a URL's query string or fragment, e.g. /callback?code=… or a redirect URL
const SENSITIVE_URL_PARAM =
  /([?&#](?:code|token|access_token|refresh_token|id_token|code_verifier|client_secret)=)[^&#\s"']+/gi;

export const redactString = (value: string): string => value.replace(SENSITIVE_URL_PARAM, `$1${REDACTED}`);

/**
 * `JSON.stringify` replacer. Only string values are replaced, so flags such as
 * `has_refresh_token: true` and nested objects (whose own keys are checked) pass through.
 */
export const redactingReplacer = (key: string, value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  return key && SENSITIVE_KEY.test(key) ? REDACTED : redactString(value);
};
