/**
 * OAuth2 API service setup
 * Provides Effect-based OAuth2ApiService for Hydra operations
 */
import { OAuth2ApiServiceLive } from '../api/oauth2.js';
import { appConfig } from '../config.js';

// Create headers for OAuth2 API
const headers: Record<string, string> = {};
if (process.env.MOCK_TLS_TERMINATION) {
  headers['X-Forwarded-Proto'] = 'https';
}

/**
 * OAuth2 API service layer (for Effect composition)
 */
export const OAuth2ApiLayer = OAuth2ApiServiceLive({
  basePath: appConfig.hydraInternalAdmin,
  headers,
});
