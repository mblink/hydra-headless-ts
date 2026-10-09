import { describe, expect, it } from 'vitest';
import { REDACTED, redactingReplacer } from './logRedaction.js';

const serialize = (value: unknown) => JSON.parse(JSON.stringify(value, redactingReplacer));

describe('redactingReplacer', () => {
  it('redacts token request bodies', () => {
    expect(
      serialize({
        grant_type: 'refresh_token',
        refresh_token: 'r-secret',
        code: 'c-secret',
        code_verifier: 'v-secret',
        client_id: 'client-1',
        client_secret: 's-secret',
      }),
    ).toEqual({
      grant_type: 'refresh_token',
      refresh_token: REDACTED,
      code: REDACTED,
      code_verifier: REDACTED,
      client_id: 'client-1',
      client_secret: REDACTED,
    });
  });

  it('redacts nested Google tokens and stored Redis values', () => {
    const logged = serialize({
      authData: { google_tokens: { tokens: { access_token: 'a', refresh_token: 'r', id_token: 'i', scope: 's' } } },
      value: { google_access_token: 'a', google_refresh_token: 'r', google_id_token: 'i', subject: 'sub-1' },
      error: { _tag: 'RedisParseError', key: 'google_token:jti', raw: '{"google_access_token":"a"}' },
      authCode: 'c',
    });

    expect(logged.authData.google_tokens.tokens).toEqual({
      access_token: REDACTED,
      refresh_token: REDACTED,
      id_token: REDACTED,
      scope: 's',
    });
    expect(logged.value).toEqual({
      google_access_token: REDACTED,
      google_refresh_token: REDACTED,
      google_id_token: REDACTED,
      subject: 'sub-1',
    });
    expect(logged.error).toEqual({ _tag: 'RedisParseError', key: 'google_token:jti', raw: REDACTED });
    expect(logged.authCode).toBe(REDACTED);
  });

  it('redacts credential headers but keeps the rest', () => {
    expect(
      serialize({
        headers: { cookie: 'connect.sid=x', authorization: 'Bearer x', 'x-csrf-token': 'x', 'user-agent': 'ua' },
      }),
    ).toEqual({
      headers: { cookie: REDACTED, authorization: REDACTED, 'x-csrf-token': REDACTED, 'user-agent': 'ua' },
    });
  });

  it('redacts credentials in URLs wherever they appear', () => {
    expect(
      serialize({
        url: '/callback?code=4/abc&state=flow-1',
        redirectUri: 'https://claude.ai/api/mcp/auth_callback?code=xyz&state=s',
        message: 'GET /validate-token?token=eyJ.a.b failed',
      }),
    ).toEqual({
      url: `/callback?code=${REDACTED}&state=flow-1`,
      redirectUri: `https://claude.ai/api/mcp/auth_callback?code=${REDACTED}&state=s`,
      message: `GET /validate-token?token=${REDACTED} failed`,
    });
  });

  it('keeps non-string values and harmless strings', () => {
    expect(
      serialize({ has_refresh_token: true, expires_in: 3600, token_type: 'Bearer', code_challenge: 'abc' }),
    ).toEqual({ has_refresh_token: true, expires_in: 3600, token_type: 'Bearer', code_challenge: 'abc' });
  });
});
