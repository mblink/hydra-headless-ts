/**
 * Bootstrap the functional environment using Effect Layers
 * Creates all services with proper dependency injection
 */
import { Configuration, OAuth2Api } from '@ory/hydra-client-fetch';
import { Layer } from 'effect';
import { OAuth2ApiServiceLive, type OAuth2ApiConfig } from '../api/oauth2.js';
import { createLoggerLayer as createEffectLoggerLayer } from '../logging-effect.js';
import { GoogleOAuthServiceLive } from './services/google.js';
import { HydraServiceLive } from './services/hydra.js';
import { JWTServiceLive } from './services/jwt.js';
import { RedisServiceLive } from './services/redis.js';
import type { Redis } from 'ioredis';

/**
 * Re-export createLoggerLayer for backwards compatibility
 */
export const createLoggerLayer = createEffectLoggerLayer;

/**
 * Create the complete application service layer from existing infrastructure
 */
export const createAppLayer = (
  redisClient: Redis,
  oauth2Config: OAuth2ApiConfig,
  config: {
    googleClientId: string;
    googleClientSecret: string;
    jwtIssuer: string;
    jwtAudience: string;
    jwtProvider: 'hydra' | 'google';
    hydraPublicUrl: string;
    hydraAdminUrl: string;
  },
) => {
  const redisLayer = RedisServiceLive(redisClient);
  const googleLayer = GoogleOAuthServiceLive({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
  });
  const jwtLayer = JWTServiceLive({
    provider: config.jwtProvider,
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    hydraPublicUrl: config.hydraPublicUrl,
    hydraAdminUrl: config.hydraAdminUrl,
  });
  const oauth2ApiLayer = OAuth2ApiServiceLive(oauth2Config);
  const loggerLayer = createEffectLoggerLayer();

  // Create legacy HydraService for routes that still use it
  const configuration = new Configuration({
    basePath: oauth2Config.basePath,
    headers: oauth2Config.headers,
  });
  const hydraClient = new OAuth2Api(configuration);
  const hydraLayer = HydraServiceLive(hydraClient);

  // Merge all service layers
  return Layer.mergeAll(redisLayer, googleLayer, jwtLayer, oauth2ApiLayer, hydraLayer, loggerLayer);
};
