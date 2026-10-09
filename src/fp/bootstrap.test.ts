import { Effect, Layer, Context } from 'effect';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OAuth2ApiService } from '../api/oauth2.js';
import { createAppLayer, createLoggerLayer } from './bootstrap.js';
import { GoogleOAuthService } from './services/google.js';
import { HydraService } from './services/hydra.js';
import { RedisService } from './services/redis.js';
import type { Redis } from 'ioredis';

// Mock Redis client
const createMockRedis = (): Redis => {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    quit: vi.fn(),
  } as unknown as Redis;
};

describe('bootstrap', () => {
  let mockRedis: Redis;

  beforeEach(() => {
    mockRedis = createMockRedis();
  });

  describe('createLoggerLayer', () => {
    it('should create valid Logger Layer from Effect', async () => {
      const loggerLayer = createLoggerLayer();

      // Logger.json is a layer that provides the default logger
      expect(Layer.isLayer(loggerLayer)).toBe(true);
    });
  });

  describe('createAppLayer', () => {
    const mockOAuth2Config = {
      basePath: 'https://hydra.example.com',
      headers: { 'X-Test': 'test' },
    };

    const mockGoogleConfig = {
      googleClientId: 'test-client-id',
      googleClientSecret: 'test-client-secret',
      jwtIssuer: 'https://test-issuer.example.com',
      jwtAudience: 'https://test-audience.example.com',
      jwtProvider: 'hydra' as const,
      hydraPublicUrl: 'https://hydra.test.example.com',
      hydraAdminUrl: 'https://hydra.test.example.com',
    };

    it('should create complete app layer with all services', async () => {
      const appLayer = createAppLayer(mockRedis, mockOAuth2Config, mockGoogleConfig);

      expect(appLayer).toBeDefined();
      expect(Layer.isLayer(appLayer)).toBe(true);
    });

    it('should provide RedisService in the layer', async () => {
      const appLayer = createAppLayer(mockRedis, mockOAuth2Config, mockGoogleConfig);

      vi.mocked(mockRedis.get).mockResolvedValue('test-value');

      const program = Effect.gen(function* () {
        const redis = yield* RedisService;
        const value = yield* redis.get('test-key');
        return value;
      });

      const result = await Effect.runPromise(Effect.provide(program, appLayer));

      expect(result).toBe('test-value');
    });

    it('should provide GoogleOAuthService in the layer', async () => {
      const appLayer = createAppLayer(mockRedis, mockOAuth2Config, mockGoogleConfig);

      const program = Effect.gen(function* () {
        const google = yield* GoogleOAuthService;
        return google;
      });

      const result = await Effect.runPromise(Effect.provide(program, appLayer));

      expect(result).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.getUserInfo).toBeDefined();
    });

    it('should provide HydraService in the layer', async () => {
      const appLayer = createAppLayer(mockRedis, mockOAuth2Config, mockGoogleConfig);

      const program = Effect.gen(function* () {
        const hydra = yield* HydraService;
        return hydra;
      });

      const result = await Effect.runPromise(Effect.provide(program, appLayer));

      expect(result).toBeDefined();
      expect(result.getLoginRequest).toBeDefined();
      expect(result.acceptLoginRequest).toBeDefined();
      expect(result.getConsentRequest).toBeDefined();
    });

    it('should provide OAuth2ApiService in the layer', async () => {
      const appLayer = createAppLayer(mockRedis, mockOAuth2Config, mockGoogleConfig);

      const program = Effect.gen(function* () {
        const oauth2 = yield* OAuth2ApiService;
        return oauth2;
      });

      const result = await Effect.runPromise(Effect.provide(program, appLayer));

      expect(result).toBeDefined();
      expect(result.getLoginRequest).toBeDefined();
      expect(result.acceptLoginRequest).toBeDefined();
    });

    it('should provide Logger layer that supports Effect logging', async () => {
      const appLayer = createAppLayer(mockRedis, mockOAuth2Config, mockGoogleConfig);

      const program = Effect.gen(function* () {
        yield* Effect.logInfo('Integration test');
        return 'logged';
      });

      const result = await Effect.runPromise(Effect.provide(program, appLayer));

      expect(result).toBe('logged');
    });

    it('should allow services to work together', async () => {
      const appLayer = createAppLayer(mockRedis, mockOAuth2Config, mockGoogleConfig);

      vi.mocked(mockRedis.set).mockResolvedValue('OK' as any);
      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify({ test: 'data' }));

      const program = Effect.gen(function* () {
        const redis = yield* RedisService;

        yield* Effect.logInfo('Storing data in Redis');
        yield* redis.set('integration-test', 'test-value');

        yield* Effect.logInfo('Retrieving data from Redis');
        const value = yield* redis.get('integration-test');

        return value;
      });

      await Effect.runPromise(Effect.provide(program, appLayer));

      expect(mockRedis.set).toHaveBeenCalled();
      expect(mockRedis.get).toHaveBeenCalled();
    });

    it('should use provided OAuth2 config for HydraService', async () => {
      const customConfig = {
        basePath: 'https://custom-hydra.example.com:4445',
        headers: { 'X-Custom-Header': 'custom-value' },
      };

      const appLayer = createAppLayer(mockRedis, customConfig, mockGoogleConfig);

      const program = Effect.gen(function* () {
        const oauth2 = yield* OAuth2ApiService;
        return oauth2;
      });

      // Should not throw
      await Effect.runPromise(Effect.provide(program, appLayer));
    });

    it('should handle multiple concurrent service operations', async () => {
      const appLayer = createAppLayer(mockRedis, mockOAuth2Config, mockGoogleConfig);

      vi.mocked(mockRedis.get).mockResolvedValue('value-1');
      vi.mocked(mockRedis.set).mockResolvedValue('OK' as any);

      const program = Effect.gen(function* () {
        const redis = yield* RedisService;

        // Run multiple operations concurrently
        const [getValue, setResult] = yield* Effect.all([redis.get('key-1'), redis.set('key-2', 'value-2')]);

        yield* Effect.logInfo('Operations completed');

        return { getValue, setResult };
      });

      const result = await Effect.runPromise(Effect.provide(program, appLayer));

      expect(result.getValue).toBe('value-1');
      expect(result.setResult).toBe('OK');
    });
  });

  describe('Layer composition', () => {
    it('should create composable layers', async () => {
      const appLayer = createAppLayer(
        mockRedis,
        { basePath: 'https://hydra.example.com', headers: {} },
        {
          googleClientId: 'client-id',
          googleClientSecret: 'client-secret',
          jwtIssuer: 'https://test-issuer.example.com',
          jwtAudience: 'https://test-audience.example.com',
          jwtProvider: 'hydra' as const,
          hydraPublicUrl: 'https://hydra.test.example.com',
          hydraAdminUrl: 'https://hydra.test.example.com',
        },
      );
      class CustomServiceTag extends Context.Tag('CustomService')<
        CustomServiceTag,
        { customMethod: () => 'custom-value' }
      >() {}
      // Create a custom layer that depends on app services
      const customLayer = Layer.succeed(CustomServiceTag, { customMethod: () => 'custom-value' });

      const combinedLayer = Layer.merge(appLayer, customLayer);

      const program = Effect.gen(function* () {
        const redis = yield* RedisService;
        return { redis };
      });

      const result = await Effect.runPromise(Effect.provide(program, combinedLayer));

      expect(result.redis).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should propagate Redis errors through the layer', async () => {
      const appLayer = createAppLayer(
        mockRedis,
        { basePath: 'https://hydra.example.com', headers: {} },
        {
          googleClientId: 'client-id',
          googleClientSecret: 'client-secret',
          jwtIssuer: 'https://test-issuer.example.com',
          jwtAudience: 'https://test-audience.example.com',
          jwtProvider: 'hydra' as const,
          hydraPublicUrl: 'https://hydra.test.example.com',
          hydraAdminUrl: 'https://hydra.test.example.com',
        },
      );

      vi.mocked(mockRedis.get).mockRejectedValue(new Error('Redis connection failed'));

      const program = Effect.gen(function* () {
        const redis = yield* RedisService;
        return yield* redis.get('test-key');
      });

      const result = await Effect.runPromise(Effect.either(Effect.provide(program, appLayer)));

      expect(result._tag).toBe('Left');
    });
  });
});
