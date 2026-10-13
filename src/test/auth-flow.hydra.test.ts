/**
 * The whole authorization flow against a real Hydra, so the test can't share our assumptions
 * about what Hydra does between /oauth2/auth, /login and /consent. Not part of `npm test`:
 * `npm run test:hydra` runs it, against the Hydra that scripts/hydra-flow-test.sh starts locally
 * or the `hydra` service in .woodpecker.yml. Hydra's login, consent and public URLs must point at
 * HYDRA_E2E_APP_URL, where this test serves the app.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLAUDE_REDIRECT_URI, expectCompletedFlow, registerClient, startApp } from './authFlow.js';

vi.mock('ioredis', () => import('./memoryRedis.js'));

const hydra = {
  host: process.env.HYDRA_E2E_HOST ?? '127.0.0.1',
  publicPort: Number(process.env.HYDRA_E2E_PUBLIC_PORT ?? 4444),
  adminPort: Number(process.env.HYDRA_E2E_ADMIN_PORT ?? 4445),
};
const appPort = Number(new URL(process.env.HYDRA_E2E_APP_URL ?? 'http://127.0.0.1:3999').port);
const adminUrl = `http://${hydra.host}:${hydra.adminPort}`;

const waitForHydra = async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = await fetch(`${adminUrl}/health/ready`).then(
      (res) => res.ok,
      () => false,
    );
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Hydra at ${adminUrl} is not ready`);
};

describe('authorization flow against Hydra', () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  // Imported after startApp: importing the app reads its configuration from the environment
  let CLIENT_SCOPE: string;

  beforeAll(async () => {
    await waitForHydra();
    app = await startApp(hydra, { port: appPort });
    ({ CLIENT_SCOPE } = await import('../authFlow.js'));
  }, 90_000);

  afterAll(async () => {
    await app?.close();
  });

  it('completes the flow for a client registered through /oauth2/register without a scope', async () => {
    const client = await registerClient(app.appUrl);
    expect(client.scope).toBe(CLIENT_SCOPE);

    await expectCompletedFlow(app.appUrl, client.client_id);
  });

  it("completes the flow for a client created like the CLI's new-client", async () => {
    const res = await fetch(`${adminUrl}/admin/clients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'cli-client',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: CLIENT_SCOPE,
        redirect_uris: [CLAUDE_REDIRECT_URI],
        token_endpoint_auth_method: 'none',
      }),
    });
    const client = (await res.json()) as { client_id: string };
    expect(res.status, JSON.stringify(client)).toBe(201);

    await expectCompletedFlow(app.appUrl, client.client_id);
  });
});
