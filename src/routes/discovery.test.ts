import express from 'express';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

describe('routes/discovery', () => {
  let server: Server;
  let baseUrl: string;
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env = { ...originalEnv, APP_ENV: 'local', BASE_URL: 'http://localhost:3000' };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      String(input).endsWith('/.well-known/openid-configuration')
        ? Promise.resolve(
            Response.json({
              issuer: 'http://localhost:4444',
              scopes_supported: ['offline_access', 'offline', 'openid'],
            }),
          )
        : originalFetch(input, init),
    );
    const { createDiscoveryRouter } = await import('./discovery-fp.js');

    const app = express();
    app.use('/.well-known/oauth-authorization-server', createDiscoveryRouter());

    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    await new Promise((resolve) => server.close(resolve));
  });

  it("advertises the scopes our clients carry instead of Hydra's built-in offline alias", async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body['issuer']).toBe('http://localhost:4444');
    expect(body['scopes_supported']).toEqual(['openid', 'email', 'profile', 'offline_access']);
  });
});
