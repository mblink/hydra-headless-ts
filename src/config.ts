/**
 * Application configuration
 * Uses Effect-based functional configuration from fp/config.ts
 */
import connectPgSimple from 'connect-pg-simple'
import session from 'express-session'
import { loadAppConfigSync, getHydraAdminUrl, getHydraInternalUrl } from './fp/config.js'

/**
 * Load configuration from environment
 * Uses Effect Config service with proper validation
 */
export const appConfig = (() => {
  const config = loadAppConfigSync()

  // Add legacy compatibility properties
  return {
    ...config,
    hostName: config.baseUrl,
    hydraPublicUrl: config.hydra.public.url,
    hydraInternalAdmin: getHydraAdminUrl(config),
    hydraInternalUrl: getHydraInternalUrl(config),
    sameSite: config.security.sameSite as 'lax' | 'none' | 'strict',
    httpOnly: config.security.httpOnly,
    secure: config.security.secure,
    googleClientId: config.google.clientId,
    googleClientSecret: config.google.clientSecret,
    csrfTokenName: config.security.csrfTokenName,
    xsrfHeaderName: config.security.xsrfHeaderName,
    redisHost: config.redis.host,
    redisPort: config.redis.port,
    jwtSecret: config.security.jwtSecret,
    jwtIssuer: config.security.jwtIssuer,
    jwtAudience: config.security.jwtAudience,
    jwtProvider: config.security.jwtProvider,
  }
})()

/**
 * Postgres configuration for connection pool
 */
export const pgConfig = {
  user: appConfig.database.user,
  password: appConfig.database.password,
  database: appConfig.database.database,
  host: appConfig.database.host,
  port: appConfig.database.port,
}

/**
 * DCR Master Client ID
 */
export const DCR_MASTER_CLIENT_ID = appConfig.dcrMasterClientId

/**
 * CSRF token generation
 *
 * Re-exported from setup/index.ts for convenience.
 * Uses csrf-csrf's double-submit cookie pattern.
 *
 * @deprecated Import directly from './setup/index.js' instead
 */
export { generateCsrfToken, doubleCsrfProtection } from './setup/index.js'

/**
 * PostgreSQL session store
 */
export const PgStore = connectPgSimple(session)

/**
 * Log loaded configuration (without secrets)
 */
import { syncLogger } from './logging-effect.js'
syncLogger.info('Configuration loaded', {
  environment: appConfig.environment,
  domain: appConfig.domain,
  port: appConfig.port,
  baseUrl: appConfig.baseUrl,
  hydraPublicUrl: appConfig.hydraPublicUrl,
  hydraAdminUrl: appConfig.hydraInternalAdmin,
  redisHost: appConfig.redisHost,
  redisPort: appConfig.redisPort,
  hasGoogleCredentials: !!(appConfig.googleClientId && appConfig.googleClientSecret),
  cimd: appConfig.cimd,
})
