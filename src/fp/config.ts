/**
 * Type-safe functional configuration using Effect Config service
 * Replaces legacy DevAppConfig/StagingAppConfig classes
 *
 * Configuration is loaded from environment variables with proper validation
 * and type safety. Uses Effect for composable, testable configuration.
 */
import { Config, Effect, pipe } from 'effect';
import type { SameSiteType } from 'csrf-csrf';

/**
 * Environment types
 */
type AppEnvironment = 'local' | 'development' | 'staging' | 'production';

/**
 * Domain configuration
 * Separates public-facing domains from private IPs for internal communication
 */
export interface DomainConfig {
  readonly public: string; // Public domain (e.g., auth.staging.yourdomain.org)
  readonly private: string; // Private IP/host for internal services (e.g., 10.1.1.230)
}

/**
 * Service endpoint configuration
 */
export interface ServiceEndpoint {
  readonly host: string;
  readonly port: number;
}

/**
 * Hydra OAuth2 server configuration
 */
export interface HydraConfig {
  readonly public: {
    readonly url: string; // Public URL for OAuth2 flows
    readonly port: number;
  };
  readonly admin: ServiceEndpoint; // Admin API (internal)
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  readonly dsn: string;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

/**
 * Google OAuth configuration
 */
export interface GoogleOAuthConfig {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly redirectUri: string;
}

/**
 * JWT Provider type
 * - 'hydra': Sign JWTs with keys from Hydra's JWKS (default)
 * - 'google': Sign JWTs with keys from Google's JWKS for MCP server compatibility
 */
type JWTProvider = 'hydra' | 'google';

/**
 * Security configuration
 */
export interface SecurityConfig {
  readonly sessionSecret: string;
  readonly cookieSecret: string;
  readonly csrfTokenName: string;
  readonly xsrfHeaderName: string;
  readonly sameSite: SameSiteType;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly mockTlsTermination: boolean;
  readonly jwtSecret: string;
  readonly jwtIssuer: string;
  readonly jwtAudience: string;
  readonly jwtProvider: JWTProvider;
}

/**
 * Complete application configuration
 */
export interface AppConfig {
  readonly environment: AppEnvironment;
  readonly domain: DomainConfig;
  readonly port: number;
  readonly baseUrl: string;
  readonly middlewareRedirectUri: string;
  readonly dcrMasterClientId: string;
  readonly dcrOriginRedirectUri: string;
  readonly hydra: HydraConfig;
  readonly redis: ServiceEndpoint;
  readonly database: DatabaseConfig;
  readonly google: GoogleOAuthConfig;
  readonly security: SecurityConfig;
  readonly logDir: string;
}

/**
 * Directory for the rotating file log. Exported on its own so logging-effect.ts can read it
 * without importing the full app config (which itself logs through logging-effect.ts).
 */
export const logDirConfig = Config.string('LOG_DIR').pipe(Config.withDefault('/var/log/hydra-headless-ts'));

/**
 * Parse APP_ENV with fallback
 */
const appEnvironmentConfig = pipe(
  Config.string('APP_ENV'),
  Config.withDefault('local' as AppEnvironment),
  Config.validate({
    message: 'Invalid APP_ENV, must be: local, development, staging, or production',
    validation: (value): value is AppEnvironment => ['local', 'development', 'staging', 'production'].includes(value),
  }),
);

/**
 * Detect if running in local environment
 */
const isLocalEnvironment = (env: AppEnvironment) => env === 'local';

/**
 * Parse BASE_URL to determine protocol
 */
const baseUrlConfig = Config.string('BASE_URL');
const isHttps = pipe(
  baseUrlConfig,
  Config.map((url) => url.startsWith('https')),
  Config.withDefault(false),
);

/**
 * Domain configuration
 * For local: uses LOCAL_DOMAIN or localhost
 * For others: derives from BASE_URL or uses explicit config
 */
const domainConfig = (env: AppEnvironment): Config.Config<DomainConfig> => {
  if (isLocalEnvironment(env)) {
    return pipe(
      Config.string('LOCAL_DOMAIN').pipe(Config.withDefault('localhost')),
      Config.map((domain) => ({
        public: domain,
        private: domain,
      })),
    );
  }

  return Config.all({
    public: pipe(
      Config.string('PUBLIC_DOMAIN'),
      Config.orElse(() =>
        pipe(
          Config.string('BASE_URL'),
          Config.map((url) => {
            try {
              return new URL(url).hostname;
            } catch {
              return 'localhost';
            }
          }),
        ),
      ),
    ),
    private: Config.string('PRIVATE_HOST').pipe(Config.withDefault('localhost')),
  });
};

/**
 * Hydra configuration
 */
const hydraConfig = (env: AppEnvironment, domain: DomainConfig): Config.Config<HydraConfig> => {
  if (isLocalEnvironment(env)) {
    return Config.succeed({
      public: {
        url: `http://${domain.public}:4444`,
        port: 4444,
      },
      admin: {
        host: domain.private,
        port: 4445,
      },
    });
  }

  return Config.all({
    public: Config.all({
      url: Config.string('HYDRA_PUBLIC_URL'),
      port: Config.integer('HYDRA_PUBLIC_PORT').pipe(Config.withDefault(4444)),
    }),
    admin: Config.all({
      host: Config.string('HYDRA_ADMIN_HOST').pipe(Config.withDefault(domain.private)),
      port: Config.integer('HYDRA_ADMIN_PORT').pipe(Config.withDefault(4445)),
    }),
  });
};

/**
 * Redis configuration
 */
const redisConfig = (env: AppEnvironment, domain: DomainConfig): Config.Config<ServiceEndpoint> => {
  if (isLocalEnvironment(env)) {
    return Config.succeed({
      host: domain.private,
      port: 6379,
    });
  }

  return Config.all({
    host: Config.string('REDIS_HOST').pipe(Config.withDefault(domain.private)),
    port: Config.integer('REDIS_PORT').pipe(Config.withDefault(16379)),
  });
};

/**
 * Database configuration
 */
const databaseConfig = (env: AppEnvironment, domain: DomainConfig): Config.Config<DatabaseConfig> => {
  const dsn = Config.string('DSN').pipe(
    Config.withDefault(
      isLocalEnvironment(env)
        ? `postgres://hydra:my-super-secret-password@${domain.private}:5432/hydra?sslmode=disable`
        : `postgres://hydra:my-super-secret-password@${domain.private}:5432/hydra`,
    ),
  );

  return Config.all({
    dsn,
    host: Config.string('POSTGRES_HOST').pipe(Config.withDefault(domain.private)),
    port: Config.integer('POSTGRES_PORT').pipe(Config.withDefault(5432)),
    user: Config.string('POSTGRES_USER').pipe(Config.withDefault('hydra')),
    password: Config.string('POSTGRES_PASSWORD').pipe(Config.withDefault('my-super-secret-password')),
    database: Config.string('POSTGRES_DB').pipe(Config.withDefault('hydra')),
  });
};

/**
 * Google OAuth configuration
 * Required for non-local environments
 */
const googleConfig = (env: AppEnvironment, baseUrl: string): Config.Config<GoogleOAuthConfig> => {
  if (isLocalEnvironment(env)) {
    return Config.succeed({
      clientId: undefined,
      clientSecret: undefined,
      redirectUri: `${baseUrl}/callback`,
    });
  }

  return pipe(
    Config.all({
      clientId: Config.string('GOOGLE_CLIENT_ID').pipe(Config.option),
      clientSecret: Config.string('GOOGLE_CLIENT_SECRET').pipe(Config.option),
      redirectUri: Config.string('GOOGLE_REDIRECT_URI').pipe(Config.withDefault(`${baseUrl}/callback`)),
    }),
    Config.map((config) => ({
      clientId: config.clientId._tag === 'Some' ? config.clientId.value : undefined,
      clientSecret: config.clientSecret._tag === 'Some' ? config.clientSecret.value : undefined,
      redirectUri: config.redirectUri,
    })),
  );
};

/**
 * Security configuration
 */
const securityConfig = (env: AppEnvironment, https: boolean, baseUrl: string): Config.Config<SecurityConfig> => {
  const isLocal = isLocalEnvironment(env);

  return Config.all({
    sessionSecret: Config.string('SESSION_SECRET').pipe(
      Config.withDefault(isLocal ? 'local-dev-secret' : 'change-me-in-production'),
    ),
    cookieSecret: Config.string('COOKIE_SECRET').pipe(Config.withDefault('G6KaOf8aJsLagw566he8yxOTTO3tInKD')),
    csrfTokenName: Config.succeed(isLocal ? 'dev_xsrf_token' : 'xsrf_token'),
    xsrfHeaderName: Config.succeed(isLocal ? 'dev_xsrf_token' : 'xsrf_token'),
    // Browsers drop SameSite=None cookies that are not Secure, so only use None over https
    sameSite: Config.succeed<SameSiteType>(!isLocal && https ? 'none' : 'lax'),
    // Cookies we set are never read by client-side JS
    httpOnly: Config.succeed(true),
    secure: Config.succeed(https),
    mockTlsTermination: Config.boolean('MOCK_TLS_TERMINATION').pipe(Config.withDefault(false)),
    jwtSecret: Config.string('JWT_SECRET').pipe(
      Config.withDefault(isLocal ? 'local-dev-jwt-secret-change-in-production' : 'CHANGE_ME_IN_PRODUCTION'),
    ),
    jwtIssuer: Config.string('JWT_ISSUER').pipe(Config.withDefault(baseUrl)),
    jwtAudience: Config.string('JWT_AUDIENCE').pipe(Config.withDefault(baseUrl)),
    jwtProvider: pipe(
      Config.string('JWT_PROVIDER'),
      Config.withDefault('hydra' as JWTProvider),
      Config.validate({
        message: 'Invalid JWT_PROVIDER, must be: hydra or google',
        validation: (value): value is JWTProvider => value === 'hydra' || value === 'google',
      }),
    ),
  });
};

/**
 * Complete application configuration
 */
export const appConfigEffect = Effect.gen(function* () {
  const env = yield* appEnvironmentConfig;
  const domain = yield* domainConfig(env);
  const baseUrl = yield* Config.string('BASE_URL');
  const https = yield* isHttps;
  const port = yield* Config.integer('PORT').pipe(Config.withDefault(3000));

  const hydra = yield* hydraConfig(env, domain);
  const redis = yield* redisConfig(env, domain);
  const database = yield* databaseConfig(env, domain);
  const google = yield* googleConfig(env, baseUrl);
  const security = yield* securityConfig(env, https, baseUrl);

  const dcrMasterClientId = yield* Config.string('DCR_MASTER_CLIENT_ID').pipe(Config.withDefault(''));

  const middlewareRedirectUri = yield* Config.string('REDIRECT_URL').pipe(Config.withDefault(`${baseUrl}/callback`));

  const logDir = yield* logDirConfig;

  const dcrOriginRedirectUri = yield* Config.string('DCR_ORIGIN_REDIRECT_URI').pipe(
    Config.withDefault('https://claude.ai/api/mcp/auth_callback'),
  );

  return {
    environment: env,
    domain,
    port,
    baseUrl,
    middlewareRedirectUri,
    dcrMasterClientId,
    dcrOriginRedirectUri,
    logDir,
    hydra,
    redis,
    database,
    google,
    security,
  };
});

/**
 * Load configuration synchronously (for backwards compatibility)
 * This should be replaced with Effect-based loading in the future
 */
export const loadAppConfigSync = (): AppConfig => {
  const result = Effect.runSync(appConfigEffect);
  return result;
};

/**
 * Helper functions for constructing URLs
 */
const constructUrl = (protocol: 'http' | 'https', host: string, port?: number): string => {
  if (!port || (protocol === 'http' && port === 80) || (protocol === 'https' && port === 443)) {
    return `${protocol}://${host}`;
  }
  return `${protocol}://${host}:${port}`;
};

/**
 * Get Hydra admin URL
 */
export const getHydraAdminUrl = (config: AppConfig): string => {
  return constructUrl('http', config.hydra.admin.host, config.hydra.admin.port);
};

/**
 * Get Hydra internal URL (for proxying)
 */
export const getHydraInternalUrl = (config: AppConfig): string => {
  return constructUrl('http', config.domain.private, config.hydra.public.port);
};
