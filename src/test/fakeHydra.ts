/**
 * Just enough of Hydra's public and admin APIs for the authorization flow, for auth-flow.test.ts.
 * It copies what Hydra v25 was observed to do (auth-flow.hydra.test.ts checks the real thing):
 *
 * - DCR gives a client registered without a scope `offline_access offline openid`.
 * - /oauth2/auth redirects to Claude's redirect_uri with invalid_scope when a requested scope isn't
 *   one of the client's.
 * - After the login is accepted, the browser goes back to the public /oauth2/auth with the query
 *   of the first request plus a login_verifier, and the consent request's request_url is the
 *   first request's URL, whatever the return leg's query says.
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';

interface Client {
  client_id: string;
  redirect_uris: string[];
  scope: string;
}

interface Flow {
  client: Client;
  requestUrl: string;
  query: URLSearchParams;
  csrf: string;
  loginVerifier?: string;
}

const HYDRA_DEFAULT_SCOPE = 'offline_access offline openid';
const CSRF_COOKIE = 'ory_hydra_login_csrf';
const id = () => randomBytes(16).toString('base64url');

const listen = async (app: express.Express) => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port };
};

export const startFakeHydra = async () => {
  const clients = new Map<string, Client>();
  const flows = new Map<string, Flow>();
  const config = { publicUrl: '' };

  const createClient = (body: Partial<Client>): Client => {
    const client = {
      client_id: id(),
      redirect_uris: body.redirect_uris ?? [],
      scope: body.scope ?? HYDRA_DEFAULT_SCOPE,
    };
    clients.set(client.client_id, client);
    return client;
  };

  const pub = express();
  pub.use(express.json());

  pub.get('/.well-known/openid-configuration', (_req, res) => {
    res.json({ issuer: config.publicUrl, scopes_supported: ['offline_access', 'offline', 'openid'] });
  });

  pub.post('/oauth2/register', (req, res) => {
    res.status(201).json(createClient(req.body as Partial<Client>));
  });

  pub.get('/oauth2/auth', (req, res) => {
    const query = new URLSearchParams(req.url.split('?')[1]);

    const loginVerifier = query.get('login_verifier');
    if (loginVerifier) {
      const flow = [...flows.values()].find((candidate) => candidate.loginVerifier === loginVerifier);
      const cookie = req.headers.cookie?.match(new RegExp(`${CSRF_COOKIE}=([^;]+)`))?.[1];
      if (!flow || !cookie || cookie !== flow.csrf) {
        res.status(403).json({ error: 'request_forbidden', error_description: 'unknown verifier or CSRF cookie' });
        return;
      }
      const consentChallenge = id();
      flows.set(consentChallenge, flow);
      res.redirect(302, `${config.publicUrl}/consent?consent_challenge=${consentChallenge}`);
      return;
    }

    const client = clients.get(query.get('client_id') ?? '');
    const redirectUri = query.get('redirect_uri') ?? '';
    if (!client?.redirect_uris.includes(redirectUri)) {
      res.status(400).json({ error: 'invalid_client' });
      return;
    }
    const allowed = client.scope.split(' ');
    const denied = (query.get('scope') ?? '').split(' ').find((scope) => scope && !allowed.includes(scope));
    if (denied) {
      const error = new URLSearchParams({
        error: 'invalid_scope',
        error_description: `The OAuth 2.0 Client is not allowed to request scope '${denied}'.`,
        state: query.get('state') ?? '',
      });
      res.redirect(303, `${redirectUri}?${error}`);
      return;
    }

    const loginChallenge = id();
    const csrf = id();
    flows.set(loginChallenge, { client, requestUrl: `${config.publicUrl}${req.url}`, query, csrf });
    res.setHeader('set-cookie', `${CSRF_COOKIE}=${csrf}; Path=/; HttpOnly`);
    res.redirect(302, `${config.publicUrl}/login?login_challenge=${loginChallenge}`);
  });

  const admin = express();
  admin.use(express.json());

  admin.post('/admin/clients', (req, res) => {
    res.status(201).json(createClient(req.body as Partial<Client>));
  });

  const flowFor = (challenge: unknown, res: express.Response) => {
    const flow = flows.get(String(challenge));
    if (!flow) res.status(404).json({ error: 'not_found' });
    return flow;
  };

  const requestBody = (challenge: string, flow: Flow) => ({
    challenge,
    client: flow.client,
    request_url: flow.requestUrl,
    requested_scope: (flow.query.get('scope') ?? '').split(' '),
    requested_access_token_audience: [],
    skip: false,
    subject: '',
  });

  admin.get('/admin/oauth2/auth/requests/login', (req, res) => {
    const flow = flowFor(req.query.login_challenge, res);
    if (flow) res.json(requestBody(String(req.query.login_challenge), flow));
  });

  admin.put('/admin/oauth2/auth/requests/login/accept', (req, res) => {
    const flow = flowFor(req.query.login_challenge, res);
    if (!flow) return;
    flow.loginVerifier = id();
    const query = new URLSearchParams(flow.query);
    query.set('login_verifier', flow.loginVerifier);
    res.json({ redirect_to: `${config.publicUrl}/oauth2/auth?${query}` });
  });

  admin.get('/admin/oauth2/auth/requests/consent', (req, res) => {
    const flow = flowFor(req.query.consent_challenge, res);
    if (flow) res.json(requestBody(String(req.query.consent_challenge), flow));
  });

  admin.put('/admin/oauth2/auth/requests/consent/accept', (req, res) => {
    const flow = flowFor(req.query.consent_challenge, res);
    if (flow) res.json({ redirect_to: `${config.publicUrl}/oauth2/auth?consent_verifier=${id()}` });
  });

  const publicServer = await listen(pub);
  const adminServer = await listen(admin);

  return {
    endpoints: { host: '127.0.0.1', publicPort: publicServer.port, adminPort: adminServer.port },
    /** Hydra's urls.self.public, urls.login and urls.consent all point at the app */
    setPublicUrl: (url: string) => {
      config.publicUrl = url;
    },
    createClient,
    close: () =>
      Promise.all([
        new Promise((resolve) => publicServer.server.close(resolve)),
        new Promise((resolve) => adminServer.server.close(resolve)),
      ]),
  };
};
