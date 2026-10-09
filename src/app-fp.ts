/**
 * Functional application entry point
 * Uses Effect-based routes with dependency injection
 */
import path, { dirname } from 'path'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import express from 'express'
import session from 'express-session'
import { OAuth2Client as GoogleOAuth2Client } from 'google-auth-library'
import { Redis } from 'ioredis'
import favicon from 'serve-favicon'
import { v4 } from 'uuid'
import { PgStore, appConfig } from './config.js'
import { createAppLayer } from './fp/bootstrap.js'
import { syncLogger } from './logging-effect.js'
import { requestLogger } from './middleware/requestLogger.js'
import pool from './pool.js'
import { createAuthzRouter } from './routes/authz-fp.js'
import { createCallbackRouter } from './routes/callback-fp.js'
import { createConsentRouter } from './routes/consent-fp.js'
import { createDeviceRouter } from './routes/device.js'
import { createDiscoveryRouter } from './routes/discovery-fp.js'
import { createIndexRouter } from './routes/index-fp.js'
import { createLoginRouter } from './routes/login-fp.js'
import { createLogoutRouter } from './routes/logout-fp.js'
import { createTokenRouter } from './routes/passthrough-auth-fp.js'
import { createValidateTokenRouter } from './routes/validate-token-fp.js'
import { OAuth2ApiLayer } from './setup/hydra.js'
import proxyMiddleware from './setup/proxy.js'
import { ErrorPage } from './views/index.js'
import type { NextFunction, Response, Request } from 'express'

const app = express()
const __dirname = import.meta.dirname

// Create Redis client
const redisClient = new Redis({
  host: appConfig.redisHost,
  port: appConfig.redisPort,
})

// Create Google OAuth2 client
const googleClient = new GoogleOAuth2Client({
  clientId: appConfig.googleClientId,
  clientSecret: appConfig.googleClientSecret,
  redirectUri: appConfig.middlewareRedirectUri,
})

// Create OAuth2 API configuration
const headers: Record<string, string> = {}
if (process.env.MOCK_TLS_TERMINATION) {
  headers['X-Forwarded-Proto'] = 'https'
}
const oauth2Config = {
  basePath: appConfig.hydraInternalAdmin,
  headers,
}

// Bootstrap functional environment with Effect Layers
const serviceLayer = createAppLayer(redisClient, oauth2Config, {
  googleClientId: appConfig.googleClientId ?? '',
  googleClientSecret: appConfig.googleClientSecret ?? '',
  jwtIssuer: appConfig.jwtIssuer,
  jwtAudience: appConfig.jwtAudience,
  jwtProvider: appConfig.jwtProvider,
  hydraPublicUrl: appConfig.hydraPublicUrl,
  hydraAdminUrl: appConfig.hydraInternalAdmin,
})

// Create config objects for routes
const consentConfig = {
  googleClientId: appConfig.googleClientId ?? '',
  middlewareRedirectUri: appConfig.middlewareRedirectUri,
}

const callbackConfig = {
  middlewareRedirectUri: appConfig.middlewareRedirectUri,
  googleClientId: appConfig.googleClientId ?? '',
}

const logoutConfig = {
  hostName: appConfig.hostName,
}
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))
// Middleware setup (same as original)
app.set('trust proxy', 1)
app.use(requestLogger)
app.use(
  session({
    store: new PgStore({
      pool,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    secret: appConfig.security.sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    // Lax, not None: the session must ride along on Google's top-level redirect to /callback,
    // and nothing needs it on cross-site subrequests
    cookie: { httpOnly: true, secure: appConfig.secure, sameSite: 'lax' },
  })
)

app.use('/oauth2/register', proxyMiddleware)
app.use('/oauth2/auth', proxyMiddleware)

app.use(cookieParser(appConfig.security.cookieSecret))

app.use(favicon(path.join(__dirname, '..', 'public', 'favicon.ico')))
app.use(express.static(path.join(dirname(import.meta.url), 'public')))

function addUniqueToken(req: Request, res: Response, next: Function) {
  req.headers['x-hydra-headless-id'] = v4()
  next()
}
app.use(addUniqueToken)

// Functional routes with Effect Layer injection
// All templates use @kitajs/html for type-safe, functional rendering
// CSRF tokens are generated per-request and passed to templates
app.use('/', createIndexRouter(serviceLayer))
app.use('/login', createLoginRouter(serviceLayer))
app.use('/logout', createLogoutRouter(serviceLayer, logoutConfig))
app.use('/consent', createConsentRouter(serviceLayer, consentConfig))
app.use('/callback', createCallbackRouter(serviceLayer, googleClient, callbackConfig))
app.use('/oauth2', createTokenRouter(serviceLayer))
app.use('/device', createDeviceRouter(OAuth2ApiLayer))
app.use('/validate-token', createValidateTokenRouter(serviceLayer))
app.use('/.well-known/oauth-authorization-server', createDiscoveryRouter())
// Called only by nginx's auth_request subrequest, never by a browser.
app.use('/authz', createAuthzRouter(serviceLayer))

// Error handlers (same as original)
app.use((req, res) => {
  syncLogger.warn('404 in app-fp.ts', { url: req.originalUrl, headers: req.headers })
  res.status(404).send("Sorry, that page doesn't exist!")
})

// Express only treats middleware with four parameters as an error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  syncLogger.error('ApplicationError', {
    url: req.originalUrl,
    message: err.message,
    stack: err.stack,
  })
  // Once the response has started, Express's default handler has to close the connection
  if (res.headersSent) {
    next(err)
    return
  }
  // Middleware like body-parser sets the status for client errors (400 for malformed JSON)
  const { status } = err as { status?: unknown }
  res.status(typeof status === 'number' && status >= 400 && status < 600 ? status : 500).send(
    ErrorPage({
      message: err.message || 'Internal server error',
      stack: app.get('env') === 'development' ? err.stack : undefined,
    })
  )
})

const listenOn = Number(process.env.PORT ?? 3000)
app.listen(listenOn, () => {
  syncLogger.info(`Functional app listening on http://0.0.0.0:${listenOn}`)
})

export default app
