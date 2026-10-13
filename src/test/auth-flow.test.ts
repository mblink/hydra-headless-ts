/**
 * The whole authorization flow through the real app against a fake Hydra (./fakeHydra.ts), so
 * `npm test` catches a break between any two legs. auth-flow.hydra.test.ts runs the same flow
 * against a real Hydra.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_REDIRECT_URI,
  expectCompletedFlow,
  registerClient,
  runAuthorizationFlow,
  startApp,
} from './authFlow.js';
import { startFakeHydra } from './fakeHydra.js';

vi.mock('ioredis', () => import('./memoryRedis.js'));

describe('authorization flow', () => {
  let hydra: Awaited<ReturnType<typeof startFakeHydra>>;
  let app: Awaited<ReturnType<typeof startApp>>;
  // Imported after startApp: importing the app reads its configuration from the environment
  let CLIENT_SCOPE: string;

  beforeAll(async () => {
    hydra = await startFakeHydra();
    app = await startApp(hydra.endpoints);
    hydra.setPublicUrl(app.appUrl);
    ({ CLIENT_SCOPE } = await import('../authFlow.js'));
  });

  afterAll(async () => {
    await app?.close();
    await hydra?.close();
  });

  it('completes the flow for a client registered through /oauth2/register without a scope', async () => {
    const client = await registerClient(app.appUrl);
    expect(client.scope).toBe(CLIENT_SCOPE);

    await expectCompletedFlow(app.appUrl, client.client_id);
  });

  it("completes the flow for a client created like the CLI's new-client", async () => {
    const client = hydra.createClient({ redirect_uris: [CLAUDE_REDIRECT_URI], scope: CLIENT_SCOPE });

    await expectCompletedFlow(app.appUrl, client.client_id);
  });

  it("gets invalid_scope back for a client that can't request the advertised scopes", async () => {
    const client = hydra.createClient({ redirect_uris: [CLAUDE_REDIRECT_URI], scope: 'openid' });

    const result = await runAuthorizationFlow(app.appUrl, client.client_id);

    expect(result.callback.get('error')).toBe('invalid_scope');
  });
});
