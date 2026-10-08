import { Effect } from 'effect'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appConfigEffect, loadAppConfigSync } from './config.js'

describe('fp/config', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Reset environment. Vite injects BASE_URL='/' into process.env, so drop it.
    process.env = { ...originalEnv }
    delete process.env.BASE_URL
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('appConfigEffect - development environment', () => {
    it('should load local development config with defaults', async () => {
      process.env.APP_ENV = 'development'
      process.env.BASE_URL = 'http://dev.domain.tld:3000'
      process.env.PUBLIC_DOMAIN = 'dev.domain.tld'
      process.env.PRIVATE_HOST = 'localhost'
      process.env.HYDRA_PUBLIC_URL = 'http://dev.domain.tld:4444'
      process.env.GOOGLE_CLIENT_ID = 'test-client-id'
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret'

      const program = Effect.gen(function* () {
        const config = yield* appConfigEffect
        return config
      })

      const result = await Effect.runPromise(program)

      expect(result.environment).toBe('development')
      expect(result.domain.public).toBe('dev.domain.tld')
      expect(result.domain.private).toBe('localhost')
      expect(result.port).toBe(3000)
      expect(result.baseUrl).toContain('dev.domain.tld')
      expect(result.google.clientId).toBe('test-client-id')
      expect(result.google.clientSecret).toBe('test-secret')
      expect(result.security.secure).toBe(false) // Development should be insecure
    })

    it('should use http for development environment', async () => {
      process.env.APP_ENV = 'development'
      process.env.BASE_URL = 'http://dev.domain.tld:3000'
      process.env.PUBLIC_DOMAIN = 'dev.domain.tld'
      process.env.PRIVATE_HOST = 'localhost'
      process.env.HYDRA_PUBLIC_URL = 'http://dev.domain.tld:4444'

      const program = Effect.gen(function* () {
        const config = yield* appConfigEffect
        return config
      })

      const result = await Effect.runPromise(program)

      expect(result.baseUrl).toMatch(/^http:\/\//)
      expect(result.hydra.public.url).toMatch(/^http:\/\//)
    })
  })

  describe('appConfigEffect - staging environment', () => {
    it('should load staging config with https', async () => {
      process.env.APP_ENV = 'staging'
      process.env.BASE_URL = 'https://auth.staging.domain.tld'
      process.env.PUBLIC_DOMAIN = 'auth.staging.domain.tld'
      process.env.PRIVATE_HOST = '10.1.1.230'
      process.env.HYDRA_PUBLIC_URL = 'https://auth.staging.domain.tld'
      process.env.HYDRA_ADMIN_HOST = '10.1.1.230'
      process.env.HYDRA_ADMIN_PORT = '4445'
      process.env.REDIS_HOST = '10.1.1.230'
      process.env.REDIS_PORT = '16379'
      process.env.DSN = 'postgres://user:pass@host:5432/db'
      process.env.GOOGLE_CLIENT_ID = 'staging-client'
      process.env.GOOGLE_CLIENT_SECRET = 'staging-secret'

      const program = Effect.gen(function* () {
        const config = yield* appConfigEffect
        return config
      })

      const result = await Effect.runPromise(program)

      expect(result.environment).toBe('staging')
      expect(result.domain.public).toBe('auth.staging.domain.tld')
      expect(result.domain.private).toBe('10.1.1.230')
      expect(result.baseUrl).toMatch(/^https:\/\//)
      expect(result.hydra.admin.host).toBe('10.1.1.230')
      expect(result.hydra.admin.port).toBe(4445)
      expect(result.redis.host).toBe('10.1.1.230')
      expect(result.redis.port).toBe(16379)
      expect(result.security.secure).toBe(true)
    })
  })

  describe('appConfigEffect - production environment', () => {
    it('should load production config with strict security', async () => {
      process.env.APP_ENV = 'production'
      process.env.BASE_URL = 'https://auth.domain.tld'
      process.env.HYDRA_PUBLIC_URL = 'https://auth.domain.tld'
      process.env.PUBLIC_DOMAIN = 'auth.domain.tld'
      process.env.PRIVATE_HOST = '10.0.0.100'
      process.env.HYDRA_ADMIN_HOST = '10.0.0.100'
      process.env.HYDRA_ADMIN_PORT = '4445'
      process.env.REDIS_HOST = '10.0.0.101'
      process.env.REDIS_PORT = '6379'
      process.env.DSN = 'postgres://user:pass@host:5432/db'
      process.env.SESSION_SECRET = 'prod-session-secret'
      process.env.COOKIE_SECRET = 'prod-cookie-secret'

      const program = Effect.gen(function* () {
        const config = yield* appConfigEffect
        return config
      })

      const result = await Effect.runPromise(program)

      expect(result.environment).toBe('production')
      expect(result.baseUrl).toMatch(/^https:\/\//)
      expect(result.security.secure).toBe(true)
      expect(result.security.sameSite).toBe('none')
      expect(result.security.sessionSecret).toBe('prod-session-secret')
      expect(result.security.cookieSecret).toBe('prod-cookie-secret')
      expect(result.redis).toEqual({ host: '10.0.0.101', port: 6379 })
      expect(result.port).toBe(3000)
    })

    it('should allow optional Google OAuth credentials in production', async () => {
      process.env.APP_ENV = 'production'
      process.env.BASE_URL = 'https://auth.domain.tld'
      process.env.HYDRA_PUBLIC_URL = 'https://auth.domain.tld'
      process.env.PUBLIC_DOMAIN = 'auth.domain.tld'
      process.env.PRIVATE_HOST = '10.0.0.100'
      process.env.HYDRA_ADMIN_HOST = '10.0.0.100'
      process.env.DSN = 'postgres://user:pass@host:5432/db'
      // No GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET

      const program = Effect.gen(function* () {
        const config = yield* appConfigEffect
        return config
      })

      const result = await Effect.runPromise(program)

      expect(result.google.clientId).toBeUndefined()
      expect(result.google.clientSecret).toBeUndefined()
      expect(result.google.redirectUri).toBe('https://auth.domain.tld/callback')
    })
  })

  describe('appConfigEffect - validation', () => {
    it('should fail when required environment variables are missing', async () => {
      process.env = {} // Clear all env vars

      const program = Effect.gen(function* () {
        const config = yield* appConfigEffect
        return config
      })

      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
    })

    it('should handle custom port from environment', async () => {
      process.env.APP_ENV = 'development'
      process.env.BASE_URL = 'http://dev.domain.tld:4000'
      process.env.PUBLIC_DOMAIN = 'dev.domain.tld'
      process.env.PRIVATE_HOST = 'localhost'
      process.env.HYDRA_PUBLIC_URL = 'http://dev.domain.tld:4444'
      process.env.PORT = '4000'

      const result = await Effect.runPromise(appConfigEffect)

      expect(result.port).toBe(4000)
      // baseUrl comes from BASE_URL verbatim; it is not derived from PORT
      expect(result.baseUrl).toBe('http://dev.domain.tld:4000')
    })

    it('should pass DSN through and read Postgres fields from POSTGRES_* vars', async () => {
      process.env.APP_ENV = 'development'
      process.env.BASE_URL = 'http://dev.domain.tld:3000'
      process.env.PUBLIC_DOMAIN = 'dev.domain.tld'
      process.env.PRIVATE_HOST = 'localhost'
      process.env.HYDRA_PUBLIC_URL = 'http://dev.domain.tld:4444'
      process.env.DSN = 'postgres://testuser:testpass@dbhost:5555/testdb?sslmode=disable'
      process.env.POSTGRES_HOST = 'dbhost'
      process.env.POSTGRES_PORT = '5555'
      process.env.POSTGRES_USER = 'testuser'
      process.env.POSTGRES_PASSWORD = 'testpass'
      process.env.POSTGRES_DB = 'testdb'

      const result = await Effect.runPromise(appConfigEffect)

      expect(result.database).toEqual({
        dsn: 'postgres://testuser:testpass@dbhost:5555/testdb?sslmode=disable',
        host: 'dbhost',
        port: 5555,
        user: 'testuser',
        password: 'testpass',
        database: 'testdb',
      })
    })

    it('should default Postgres fields to the private host when unset', async () => {
      process.env.APP_ENV = 'staging'
      process.env.BASE_URL = 'https://auth.staging.domain.tld'
      process.env.HYDRA_PUBLIC_URL = 'https://auth.staging.domain.tld'
      process.env.PRIVATE_HOST = '10.1.1.230'

      const result = await Effect.runPromise(appConfigEffect)

      expect(result.database.host).toBe('10.1.1.230')
      expect(result.database.port).toBe(5432)
      expect(result.database.dsn).toBe(
        'postgres://hydra:my-super-secret-password@10.1.1.230:5432/hydra'
      )
    })

    it('should reject an invalid APP_ENV', async () => {
      process.env.APP_ENV = 'qa'
      process.env.BASE_URL = 'http://localhost:3000'

      const result = await Effect.runPromise(Effect.either(appConfigEffect))

      expect(result._tag).toBe('Left')
    })

    it('should reject an invalid JWT_PROVIDER', async () => {
      process.env.APP_ENV = 'local'
      process.env.BASE_URL = 'http://localhost:3000'
      process.env.JWT_PROVIDER = 'auth0'

      const result = await Effect.runPromise(Effect.either(appConfigEffect))

      expect(result._tag).toBe('Left')
    })

    it('should require HYDRA_PUBLIC_URL outside local', async () => {
      process.env.APP_ENV = 'staging'
      process.env.BASE_URL = 'https://auth.staging.domain.tld'
      delete process.env.HYDRA_PUBLIC_URL

      const result = await Effect.runPromise(Effect.either(appConfigEffect))

      expect(result._tag).toBe('Left')
    })
  })

  describe('appConfigEffect - local environment', () => {
    it('should derive Hydra and Redis endpoints from LOCAL_DOMAIN', async () => {
      process.env.APP_ENV = 'local'
      process.env.BASE_URL = 'http://localhost:3000'
      process.env.LOCAL_DOMAIN = 'dev.local'

      const result = await Effect.runPromise(appConfigEffect)

      expect(result.domain).toEqual({ public: 'dev.local', private: 'dev.local' })
      expect(result.hydra.public).toEqual({ url: 'http://dev.local:4444', port: 4444 })
      expect(result.hydra.admin).toEqual({ host: 'dev.local', port: 4445 })
      expect(result.redis).toEqual({ host: 'dev.local', port: 6379 })
      expect(result.google.clientId).toBeUndefined()
      expect(result.security.csrfTokenName).toBe('dev_xsrf_token')
      expect(result.security.sameSite).toBe('lax')
      expect(result.security.jwtProvider).toBe('hydra')
      expect(result.security.jwtIssuer).toBe('http://localhost:3000')
      expect(result.middlewareRedirectUri).toBe('http://localhost:3000/callback')
      expect(result.dcrOriginRedirectUri).toBe('https://claude.ai/api/mcp/auth_callback')
    })
  })

  describe('loadAppConfigSync', () => {
    it('should synchronously load config', () => {
      process.env.APP_ENV = 'development'
      process.env.BASE_URL = 'http://dev.domain.tld:3000'
      process.env.PUBLIC_DOMAIN = 'dev.domain.tld'
      process.env.PRIVATE_HOST = 'localhost'
      process.env.HYDRA_PUBLIC_URL = 'http://dev.domain.tld:4444'

      const config = loadAppConfigSync()

      expect(config.environment).toBe('development')
      expect(config.domain.public).toBe('dev.domain.tld')
    })

    it('should throw on invalid config', () => {
      process.env = {} // Clear all env vars

      expect(() => loadAppConfigSync()).toThrow()
    })
  })

  describe('DomainConfig', () => {
    it('should support separate public and private domains', async () => {
      process.env.APP_ENV = 'staging'
      process.env.BASE_URL = 'https://auth.staging.domain.tld'
      process.env.HYDRA_PUBLIC_URL = 'https://auth.staging.domain.tld'
      process.env.PUBLIC_DOMAIN = 'auth.staging.domain.tld'
      process.env.PRIVATE_HOST = '10.1.1.230'
      process.env.HYDRA_ADMIN_HOST = '10.1.1.230'
      process.env.DSN = 'postgres://user:pass@host:5432/db'

      const program = Effect.gen(function* () {
        const config = yield* appConfigEffect
        return config
      })

      const result = await Effect.runPromise(program)

      expect(result.domain.public).toBe('auth.staging.domain.tld')
      expect(result.domain.private).toBe('10.1.1.230')
      expect(result.baseUrl).toContain('auth.staging.domain.tld')
      expect(result.hydra.admin.host).toBe('10.1.1.230')
    })
  })

  describe('Environment defaults', () => {
    it('should default to local when APP_ENV is not set', async () => {
      delete process.env.APP_ENV
      process.env.BASE_URL = 'http://localhost:3000'
      process.env.PUBLIC_DOMAIN = 'dev.domain.tld'
      process.env.PRIVATE_HOST = 'localhost'
      process.env.HYDRA_PUBLIC_URL = 'http://dev.domain.tld:4444'

      const program = Effect.gen(function* () {
        const config = yield* appConfigEffect
        return config
      })

      const result = await Effect.runPromise(program)

      expect(result.environment).toBe('local')
    })
  })
})
