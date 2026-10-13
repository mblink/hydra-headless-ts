/**
 * Drives the whole authorization flow the way Claude and a browser do: discovery, /oauth2/auth,
 * every redirect between this app and Hydra (with cookies), Google, /callback, and the code
 * exchange at /oauth2/token. auth-flow.test.ts runs it against a fake Hydra and
 * auth-flow.hydra.test.ts against a real one.
 *
 * The app reads its configuration when first imported, so startApp sets the environment and
 * then imports it. Test files must mock ioredis with ./memoryRedis.js before calling it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import session from 'express-session';
import { SignJWT } from 'jose';
import { expect } from 'vitest';
import type { GoogleOAuthClient } from '../fp/services/callback.js';
import type { AddressInfo } from 'node:net';

export const CLAUDE_REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_CLIENT_ID = 'test-google-client-id';
const USER = { sub: 'google-sub-123', email: 'user@example.com' };

/** Google's side of /consent and /callback: hands back tokens for the test user */
const fakeGoogle: GoogleOAuthClient = {
  getToken: async () => ({
    tokens: {
      access_token: 'google-access-token',
      refresh_token: 'google-refresh-token',
      id_token: await new SignJWT({ email: USER.email, email_verified: true })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(USER.sub)
        .setIssuer('https://accounts.google.com')
        .setAudience(GOOGLE_CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode('test-google-signing-secret')),
      scope: 'openid email profile',
      token_type: 'Bearer',
      expiry_date: Date.now() + 3600_000,
    },
  }),
  verifyIdToken: async () => ({ getPayload: () => ({ ...USER, email_verified: true }) }),
};

export interface HydraEndpoints {
  host: string;
  publicPort: number;
  adminPort: number;
}

/**
 * Listen first, so the app's own URL is known before its configuration is read. Pass a fixed
 * port when Hydra has to be configured with the app's URL ahead of time.
 */
export const startApp = async (hydra: HydraEndpoints, port = 0) => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const appUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const allowlist = path.join(tmpdir(), `allowed_emails_${process.pid}.txt`);
  writeFileSync(allowlist, `${USER.email}\n`);

  process.env = {
    ...process.env,
    APP_ENV: 'staging',
    BASE_URL: appUrl,
    SESSION_SECRET: 'test-session-secret',
    COOKIE_SECRET: 'test-cookie-secret',
    PRIVATE_HOST: hydra.host,
    HYDRA_PUBLIC_URL: appUrl,
    HYDRA_PUBLIC_PORT: String(hydra.publicPort),
    HYDRA_ADMIN_HOST: hydra.host,
    HYDRA_ADMIN_PORT: String(hydra.adminPort),
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    JWT_PROVIDER: 'google',
    EMAIL_ALLOWLIST_PATH: allowlist,
  };
  const { createApp } = await import('../app.js');
  server.on('request', createApp({ sessionStore: new session.MemoryStore(), googleClient: fakeGoogle }));

  return {
    appUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

/** A browser's cookie jar and redirect handling, recording every hop for failure messages */
const createBrowser = () => {
  const cookies = new Map<string, Map<string, string>>();
  const hops: string[] = [];

  const request = async (url: string, init: RequestInit = {}) => {
    const { origin } = new URL(url);
    const jar = cookies.get(origin) ?? new Map<string, string>();
    cookies.set(origin, jar);
    const headers = new Headers(init.headers);
    if (jar.size > 0) {
      headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    const res = await fetch(url, { ...init, headers, redirect: 'manual' });
    for (const setCookie of res.headers.getSetCookie()) {
      const [pair] = setCookie.split(';');
      const eq = pair.indexOf('=');
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    hops.push(`${init.method ?? 'GET'} ${url.slice(0, 160)} -> ${res.status}`);
    return res;
  };

  return { request, hops };
};

export interface FlowResult {
  /** What Claude received at its redirect_uri */
  callback: URLSearchParams;
  state: string;
  scope: string;
  /** The /oauth2/token response for the returned code */
  token: { status: number; body: Record<string, unknown> };
  hops: string[];
}

/**
 * Run the authorization code flow for `clientId` and exchange the code. Throws, with every hop,
 * if the browser lands anywhere other than a redirect before reaching Claude's redirect_uri.
 */
export const runAuthorizationFlow = async (appUrl: string, clientId: string): Promise<FlowResult> => {
  const browser = createBrowser();

  // Claude requests every scope the authorization server advertises
  const discovery = await browser.request(`${appUrl}/.well-known/oauth-authorization-server`);
  const { scopes_supported } = (await discovery.json()) as { scopes_supported: string[] };
  const scope = scopes_supported.join(' ');

  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const authorize = new URL(`${appUrl}/oauth2/auth`);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CLAUDE_REDIRECT_URI,
    scope,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'consent',
  }).toString();

  let url = authorize.toString();
  for (let hop = 0; hop < 15; hop++) {
    if (url.startsWith(GOOGLE_AUTH_URL)) {
      // Google signs the user in and returns to /callback with the state it was given
      const googleState = new URL(url).searchParams.get('state') ?? '';
      url = `${appUrl}/callback?${new URLSearchParams({ code: 'google-code', state: googleState })}`;
      continue;
    }
    if (url.startsWith(CLAUDE_REDIRECT_URI)) {
      const callback = new URL(url).searchParams;
      const code = callback.get('code');
      const token = code
        ? await browser.request(`${appUrl}/oauth2/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              code_verifier: verifier,
              client_id: clientId,
              redirect_uri: CLAUDE_REDIRECT_URI,
            }),
          })
        : undefined;
      return {
        callback,
        state,
        scope,
        token: token
          ? { status: token.status, body: (await token.json()) as Record<string, unknown> }
          : { status: 0, body: {} },
        hops: browser.hops,
      };
    }

    const res = await browser.request(url);
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) {
      const body = (await res.text()).slice(0, 500);
      throw new Error(`The flow stopped at ${url} with ${res.status}: ${body}\n\nHops:\n${browser.hops.join('\n')}`);
    }
    url = new URL(location, url).toString();
  }
  throw new Error(`The flow did not reach ${CLAUDE_REDIRECT_URI}\n\nHops:\n${browser.hops.join('\n')}`);
};

/** Run the flow for `clientId` and check Claude gets a code it can exchange for a token */
export const expectCompletedFlow = async (appUrl: string, clientId: string) => {
  const result = await runAuthorizationFlow(appUrl, clientId);

  expect(
    result.callback.get('error'),
    `${result.callback.get('error_description')}\n${result.hops.join('\n')}`,
  ).toBeNull();
  expect(result.callback.get('state')).toBe(result.state);
  expect(result.callback.get('code')).toBeTruthy();
  expect(result.token.status, JSON.stringify(result.token.body)).toBe(200);
  expect(result.token.body).toMatchObject({ token_type: 'Bearer', scope: result.scope });
  expect(result.token.body.access_token).toEqual(expect.any(String));
};

/** Register a client through the app's /oauth2/register the way Claude does, without a scope */
export const registerClient = async (appUrl: string) => {
  const res = await fetch(`${appUrl}/oauth2/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Claude',
      redirect_uris: [CLAUDE_REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const client = (await res.json()) as { client_id: string; scope: string };
  expect(res.status, JSON.stringify(client)).toBe(201);
  return client;
};
