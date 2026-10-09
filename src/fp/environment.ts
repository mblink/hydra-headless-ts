/**
 * Application environment (dependencies) for ReaderTaskEither pattern
 * This provides dependency injection in a functional way
 */
import type { GoogleOAuthService } from './services/google.js';
import type { HydraService } from './services/hydra.js';
import type { RedisService } from './services/redis.js';

/**
 * Logging service interface
 */
export interface Logger {
  debug: (message: string, meta?: object) => void;
  info: (message: string, meta?: object) => void;
  warn: (message: string, meta?: object) => void;
  error: (message: string, meta?: object) => void;
  silly: (message: string, meta?: object) => void;
}

/**
 * Application configuration
 */
export interface AppConfig {
  googleClientId: string;
  googleClientSecret: string;
  hydraUrl: string;
  redisHost: string;
  redisPort: number;
  middlewareRedirectUri: string;
  hostName: string;
}

/**
 * Complete application environment
 * All services and dependencies available to business logic
 */
export interface AppEnvironment {
  redis: RedisService;
  google: GoogleOAuthService;
  hydra: HydraService;
  logger: Logger;
  config: AppConfig;
}

/**
 * Helper type to extract environment from ReaderTaskEither
 */
export type Env<R> = R extends { _R: infer E } ? E : never;
