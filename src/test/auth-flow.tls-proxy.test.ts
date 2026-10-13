/**
 * The authorization flow with the app configured as staging and prod run it: an https BASE_URL, so
 * the session cookie is Secure, served over http behind a proxy that sends X-Forwarded-Proto.
 * auth-flow.test.ts runs without either, so it can't see the session cookie go missing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLAUDE_REDIRECT_URI, expectCompletedFlow, runAuthorizationFlow, startApp } from './authFlow.js';
import { startFakeHydra } from './fakeHydra.js';

vi.mock('ioredis', () => import('./memoryRedis.js'));

describe('authorization flow behind a TLS-terminating proxy', () => {
  let hydra: Awaited<ReturnType<typeof startFakeHydra>>;
  let app: Awaited<ReturnType<typeof startApp>>;
  let clientId: string;

  beforeAll(async () => {
    hydra = await startFakeHydra();
    app = await startApp(hydra.endpoints, { behindTlsProxy: true });
    hydra.setPublicUrl(app.appUrl);
    const { CLIENT_SCOPE } = await import('../authFlow.js');
    clientId = hydra.createClient({ redirect_uris: [CLAUDE_REDIRECT_URI], scope: CLIENT_SCOPE }).client_id;
  });

  afterAll(async () => {
    await app?.close();
    await hydra?.close();
  });

  it('completes the flow when the proxy forwards X-Forwarded-Proto: https', async () => {
    await expectCompletedFlow(app.appUrl, clientId, { forwardedProto: 'https' });
  });

  // What staging did while nginx sent $scheme: express-session never set the Secure cookie on the
  // first /oauth2/auth, so the login return came back in a new session. This also shows the test
  // above really depends on the cookie.
  it('loses the session at the login return when the proxy forwards X-Forwarded-Proto: http', async () => {
    await expect(runAuthorizationFlow(app.appUrl, clientId, { forwardedProto: 'http' })).rejects.toThrow(
      /oauth2\/auth\?[^\n]*login_verifier=[^\n]* with 400: [^\n]*Authorization request not found or expired/,
    );
  });
});
