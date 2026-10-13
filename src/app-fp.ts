/**
 * Functional application entry point
 * Builds the app (src/app.ts) with the Postgres session store and Google's client, and listens
 */
import { OAuth2Client as GoogleOAuth2Client } from 'google-auth-library';
import { createApp } from './app.js';
import { PgStore, appConfig } from './config.js';
import { syncLogger } from './logging-effect.js';
import pool from './pool.js';

// Create Google OAuth2 client
const googleClient = new GoogleOAuth2Client({
  clientId: appConfig.googleClientId,
  clientSecret: appConfig.googleClientSecret,
  redirectUri: appConfig.middlewareRedirectUri,
});

const app = createApp({
  sessionStore: new PgStore({
    pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  googleClient,
});

const listenOn = Number(process.env.PORT ?? 3000);
app.listen(listenOn, () => {
  syncLogger.info(`Functional app listening on http://0.0.0.0:${listenOn}`);
});

export default app;
