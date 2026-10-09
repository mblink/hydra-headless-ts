import http from 'node:http';
import express from 'express';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { RequestHandler } from 'express';
import type { AddressInfo } from 'node:net';

// In-memory ioredis replacement shared with the test
const redisStore = new Map<string, string>();
let failRedisWrites = false;
vi.mock('ioredis', () => ({
  // eslint-disable-next-line prefer-arrow-callback -- must be constructible with `new`
  Redis: vi.fn(function () {
    return {
      get: async (key: string) => redisStore.get(key) ?? null,
      set: async (key: string, value: string) => {
        if (failRedisWrites) throw new Error('connection lost');
        redisStore.set(key, value);
        return 'OK';
      },
      del: async (...keys: string[]) => keys.filter((k) => redisStore.delete(k)).length,
      exists: async (...keys: string[]) => keys.filter((k) => redisStore.has(k)).length,
    };
  }),
}));

interface Received {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

describe('setup/proxy (Hydra passthrough)', () => {
  let upstream: http.Server;
  let app: http.Server;
  let appUrl: string;
  const received: Received[] = [];
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    // Fake Hydra public endpoint that records what it receives
    upstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    process.env = {
      ...originalEnv,
      APP_ENV: 'staging',
      SESSION_SECRET: 'test-session-secret',
      COOKIE_SECRET: 'test-cookie-secret',
      BASE_URL: 'https://auth.example.com',
      HYDRA_PUBLIC_URL: 'https://auth.example.com',
      HYDRA_PUBLIC_PORT: String(upstreamPort),
      PRIVATE_HOST: '127.0.0.1',
    };
    const { default: proxyMiddleware } = await import('./proxy.js');

    // Mount the same way app-fp.ts does
    const server = express();
    server.use(express.json());
    server.use(express.urlencoded({ extended: false }));
    server.use(((req, _res, next) => {
      (req as unknown as { session: object }).session = { id: 'session-123' };
      next();
    }) as RequestHandler);
    server.use('/oauth2/register', proxyMiddleware);
    server.use('/oauth2/auth', proxyMiddleware);

    app = server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => app.once('listening', resolve));
    appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    process.env = originalEnv;
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  });

  beforeEach(() => {
    received.length = 0;
    redisStore.clear();
    failRedisWrites = false;
  });

  // BASE64URL(SHA-256) of a verifier is always 43 characters
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  const authQuery = (state: string) =>
    new URLSearchParams({
      client_id: 'client-1',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      response_type: 'code',
      scope: 'openid email',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

  it('stores PKCE state under a new flow id and forwards /oauth2/auth with it as state', async () => {
    const res = await fetch(`${appUrl}/oauth2/auth?${authQuery('client-state')}`, {
      redirect: 'manual',
    });

    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    const forwarded = new URL(received[0].url, 'http://hydra');
    expect(forwarded.pathname).toBe('/oauth2/auth');
    expect(forwarded.searchParams.get('code_challenge')).toBeNull();
    expect(forwarded.searchParams.get('code_challenge_method')).toBeNull();
    expect(forwarded.searchParams.get('client_id')).toBe('client-1');

    // The state is a random flow id, never the session id
    const flowId = forwarded.searchParams.get('state')!;
    expect(flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(flowId).not.toContain('session-123');

    expect([...redisStore.keys()]).toEqual([`pkce_session:${flowId}`]);
    expect(JSON.parse(redisStore.get(`pkce_session:${flowId}`)!)).toMatchObject({
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'client-state',
      client_id: 'client-1',
      scope: 'openid email',
      // The callback checks the Google response comes back to this session
      session_id: 'session-123',
    });
  });

  it('keeps overlapping flows from the same session apart', async () => {
    await fetch(`${appUrl}/oauth2/auth?${authQuery('first')}`, { redirect: 'manual' });
    await fetch(`${appUrl}/oauth2/auth?${authQuery('second')}`, { redirect: 'manual' });

    const states = received.map((r) => new URL(r.url, 'http://hydra').searchParams.get('state'));
    expect(new Set(states).size).toBe(2);
    const stored = states.map((id) => JSON.parse(redisStore.get(`pkce_session:${id}`)!).state);
    expect(stored).toEqual(['first', 'second']);
  });

  it('forwards a JSON registration body to Hydra', async () => {
    const body = {
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    };

    const res = await fetch(`${appUrl}/oauth2/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe('POST');
    expect(new URL(received[0].url, 'http://hydra').pathname).toBe('/oauth2/register');
    expect(JSON.parse(received[0].body)).toEqual(body);
  });

  it('rewrites null contacts to [] with a matching Content-Length', async () => {
    const res = await fetch(`${appUrl}/oauth2/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['http://localhost:6274/cb'], contacts: null }),
    });

    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0].body)).toEqual({
      client_name: 'Claude',
      redirect_uris: ['http://localhost:6274/cb'],
      contacts: [],
    });
    expect(Number(received[0].headers['content-length'])).toBe(Buffer.byteLength(received[0].body));
  });

  it('recomputes Content-Length when re-serializing changes the body size', async () => {
    const body = { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] };

    const res = await fetch(`${appUrl}/oauth2/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Pretty-printed: longer than the JSON.stringify output the proxy sends upstream
      body: JSON.stringify(body, null, 2),
    });

    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0].body)).toEqual(body);
    expect(Number(received[0].headers['content-length'])).toBe(Buffer.byteLength(received[0].body));
  });

  it('forwards an empty JSON body without hanging', async () => {
    const res = await fetch(`${appUrl}/oauth2/register/client-1`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });

    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].body).toBe('{}');
    expect(received[0].headers['content-length']).toBe('2');
  });

  it('forwards a form-encoded body as form-encoded', async () => {
    const res = await fetch(`${appUrl}/oauth2/register/client-1`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_name: 'Claude', scope: 'openid email' }),
      signal: AbortSignal.timeout(5000),
    });

    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].headers['content-type']).toContain('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(received[0].body))).toEqual({
      client_name: 'Claude',
      scope: 'openid email',
    });
    expect(Number(received[0].headers['content-length'])).toBe(Buffer.byteLength(received[0].body));
  });

  it('rejects /oauth2/auth without required parameters before reaching Hydra', async () => {
    const res = await fetch(`${appUrl}/oauth2/auth?response_type=code`, { redirect: 'manual' });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
    expect(received).toHaveLength(0);
  });

  it('rejects /oauth2/auth with an unsupported response_type', async () => {
    const query = authQuery('client-state');
    query.set('response_type', 'token');

    const res = await fetch(`${appUrl}/oauth2/auth?${query}`, { redirect: 'manual' });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unsupported_response_type' });
    expect(received).toHaveLength(0);
  });

  it('rejects a POST to /oauth2/auth instead of forwarding it without the flow id', async () => {
    const res = await fetch(`${appUrl}/oauth2/auth?${authQuery('client-state')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
      redirect: 'manual',
    });

    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
    expect(received).toHaveLength(0);
  });

  const rejectsAuth = async (query: URLSearchParams, error_description: string | RegExp) => {
    const res = await fetch(`${appUrl}/oauth2/auth?${query}`, { redirect: 'manual' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toMatch(error_description);
    expect(received).toHaveLength(0);
    expect(redisStore.size).toBe(0);
  };

  it('rejects a repeated parameter instead of using a different value than Hydra', async () => {
    const query = authQuery('client-state');
    query.append('redirect_uri', '@evil.com');
    await rejectsAuth(query, 'redirect_uri must be given exactly once');
  });

  it('rejects a redirect_uri outside the allowlist', async () => {
    const query = authQuery('client-state');
    query.set('redirect_uri', 'https://evil.com/cb');
    await rejectsAuth(query, 'redirect_uri is not allowed');
  });

  it('accepts a loopback redirect_uri', async () => {
    const query = authQuery('client-state');
    query.set('redirect_uri', 'http://127.0.0.1:33418/callback');
    const res = await fetch(`${appUrl}/oauth2/auth?${query}`, { redirect: 'manual' });
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
  });

  it('rejects plain and missing PKCE methods', async () => {
    const plain = authQuery('client-state');
    plain.set('code_challenge_method', 'plain');
    await rejectsAuth(plain, 'code_challenge_method must be S256');

    const missing = authQuery('client-state');
    missing.delete('code_challenge_method');
    await rejectsAuth(missing, 'code_challenge_method must be S256');
  });

  it('rejects a code_challenge that is not a SHA-256 hash', async () => {
    const query = authQuery('client-state');
    query.set('code_challenge', 'challenge-abc');
    await rejectsAuth(query, 'code_challenge must be a base64url-encoded SHA-256 hash');
  });

  it('rejects a request without code_challenge or state', async () => {
    const query = authQuery('client-state');
    query.delete('code_challenge');
    query.delete('state');
    await rejectsAuth(query, 'Missing required parameters: code_challenge, state');
  });

  it('stops with 503 when the flow cannot be stored', async () => {
    failRedisWrites = true;
    const res = await fetch(`${appUrl}/oauth2/auth?${authQuery('client-state')}`, { redirect: 'manual' });

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'temporarily_unavailable' });
    expect(received).toHaveLength(0);
  });

  it.each(['POST', 'PUT'])('rejects a %s registration with a redirect_uri outside the allowlist', async (method) => {
    const res = await fetch(`${appUrl}/oauth2/register${method === 'PUT' ? '/client-1' : ''}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Evil',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback', 'https://evil.com/cb'],
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid_redirect_uri',
      error_description: 'redirect_uri is not allowed: https://evil.com/cb',
    });
    expect(received).toHaveLength(0);
  });

  it('rejects a registration without redirect_uris', async () => {
    const res = await fetch(`${appUrl}/oauth2/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude' }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_redirect_uri' });
    expect(received).toHaveLength(0);
  });
});
