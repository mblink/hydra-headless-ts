import { Layer } from 'effect';
import express from 'express';
import session from 'express-session';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { HydraService } from '../fp/services/hydra.js';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

describe('routes/logout', () => {
  let server: Server;
  let baseUrl: string;
  const getLogoutRequest = vi.fn();
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    process.env = { ...originalEnv, APP_ENV: 'local', BASE_URL: 'http://localhost:3000' };
    const { createLogoutRouter } = await import('./logout-fp.js');

    const hydraLayer = Layer.succeed(HydraService, { getLogoutRequest } as unknown as HydraService);

    const app = express();
    app.use(session({ secret: 'test-session-secret', resave: false, saveUninitialized: false }));
    app.use('/logout', createLogoutRouter(hydraLayer, { hostName: 'http://localhost:3000' }));
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).send(err.message);
    });

    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    process.env = originalEnv;
    await new Promise((resolve) => server.close(resolve));
  });

  it('fails without asking Hydra when there is no logout challenge', async () => {
    const res = await fetch(`${baseUrl}/logout`);

    expect(res.status).toBe(500);
    expect(await res.text()).toContain('Expected a logout challenge');
    expect(getLogoutRequest).not.toHaveBeenCalled();
  });
});
