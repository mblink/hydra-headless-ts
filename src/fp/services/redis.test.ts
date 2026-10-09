import { Effect, Schema } from 'effect'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  RedisConnectionError,
  RedisKeyNotFound,
  RedisParseError,
  RedisWriteError,
  RedisDeleteError,
} from '../errors.js'
import { makeRedisService, createOAuthRedisOps } from './redis.js'
import type { Redis } from 'ioredis'

// Mock Redis client
const createMockRedis = (): Redis => {
  const store = new Map<string, string>()

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0
      for (const key of keys) {
        if (store.delete(key)) count++
      }
      return count
    }),
    exists: vi.fn(async (...keys: string[]) => {
      let count = 0
      for (const key of keys) {
        if (store.has(key)) count++
      }
      return count
    }),
    // Add other methods as needed for typing
  } as unknown as Redis
}

describe('RedisService', () => {
  let mockRedis: Redis
  let redisService: ReturnType<typeof makeRedisService>

  beforeEach(() => {
    mockRedis = createMockRedis()
    redisService = makeRedisService(mockRedis)
  })

  describe('get', () => {
    it('should get a value from Redis', async () => {
      vi.mocked(mockRedis.get).mockResolvedValue('test-value')

      const program = redisService.get('test-key')
      const result = await Effect.runPromise(program)

      expect(result).toBe('test-value')
      expect(mockRedis.get).toHaveBeenCalledWith('test-key')
    })

    it('should return null for non-existent key', async () => {
      vi.mocked(mockRedis.get).mockResolvedValue(null)

      const program = redisService.get('missing-key')
      const result = await Effect.runPromise(program)

      expect(result).toBeNull()
    })

    it('should handle Redis connection errors', async () => {
      vi.mocked(mockRedis.get).mockRejectedValue(new Error('Connection failed'))

      const program = redisService.get('test-key')
      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(RedisConnectionError)
      }
    })
  })

  describe('getJSON', () => {
    it('should get and parse JSON with schema validation', async () => {
      const TestSchema = Schema.Struct({
        id: Schema.String,
        count: Schema.Number,
      })

      const testData = { id: 'test-123', count: 42 }
      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(testData))

      const program = redisService.getJSON('test-key', TestSchema)
      const result = await Effect.runPromise(program)

      expect(result).toEqual(testData)
    })

    it('should fail when key does not exist', async () => {
      const TestSchema = Schema.Struct({ id: Schema.String })
      vi.mocked(mockRedis.get).mockResolvedValue(null)

      const program = redisService.getJSON('missing-key', TestSchema)
      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(RedisKeyNotFound)
      }
    })

    it('should fail on invalid JSON', async () => {
      const TestSchema = Schema.Struct({ id: Schema.String })
      vi.mocked(mockRedis.get).mockResolvedValue('invalid-json{')

      const program = redisService.getJSON('test-key', TestSchema)
      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(RedisParseError)
      }
    })

    it('should fail on schema validation error', async () => {
      const TestSchema = Schema.Struct({
        id: Schema.String,
        count: Schema.Number,
      })

      // Missing required field 'count'
      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify({ id: 'test' }))

      const program = redisService.getJSON('test-key', TestSchema)
      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
    })
  })

  describe('set', () => {
    it('should set a value in Redis', async () => {
      const program = redisService.set('test-key', 'test-value')
      const result = await Effect.runPromise(program)

      expect(result).toBe('OK')
      expect(mockRedis.set).toHaveBeenCalledWith('test-key', 'test-value')
    })

    it('should set a value with expiration', async () => {
      const program = redisService.set('test-key', 'test-value', 3600)
      const result = await Effect.runPromise(program)

      expect(result).toBe('OK')
      expect(mockRedis.set).toHaveBeenCalledWith('test-key', 'test-value', 'EX', 3600)
    })

    it('should handle write errors', async () => {
      vi.mocked(mockRedis.set).mockRejectedValue(new Error('Write failed'))

      const program = redisService.set('test-key', 'test-value')
      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(RedisWriteError)
      }
    })
  })

  describe('setJSON', () => {
    it('should stringify and set JSON value', async () => {
      const testData = { id: 'test-123', count: 42 }

      const program = redisService.setJSON('test-key', testData)
      const result = await Effect.runPromise(program)

      expect(result).toBe('OK')
      expect(mockRedis.set).toHaveBeenCalledWith('test-key', JSON.stringify(testData))
    })

    it('should set JSON with expiration', async () => {
      const testData = { id: 'test' }

      const program = redisService.setJSON('test-key', testData, 300)
      const result = await Effect.runPromise(program)

      expect(result).toBe('OK')
      expect(mockRedis.set).toHaveBeenCalledWith('test-key', JSON.stringify(testData), 'EX', 300)
    })

    it('should handle circular references', async () => {
      const circular: any = { id: 'test' }
      circular.self = circular

      const program = redisService.setJSON('test-key', circular)
      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(RedisWriteError)
      }
    })
  })

  describe('del', () => {
    it('should delete a single key', async () => {
      vi.mocked(mockRedis.del).mockResolvedValue(1)

      const program = redisService.del('test-key')
      const result = await Effect.runPromise(program)

      expect(result).toBe(1)
      expect(mockRedis.del).toHaveBeenCalledWith('test-key')
    })

    it('should delete multiple keys', async () => {
      vi.mocked(mockRedis.del).mockResolvedValue(3)

      const program = redisService.del('key1', 'key2', 'key3')
      const result = await Effect.runPromise(program)

      expect(result).toBe(3)
      expect(mockRedis.del).toHaveBeenCalledWith('key1', 'key2', 'key3')
    })

    it('should handle delete errors', async () => {
      vi.mocked(mockRedis.del).mockRejectedValue(new Error('Delete failed'))

      const program = redisService.del('test-key')
      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(RedisDeleteError)
      }
    })
  })

  describe('exists', () => {
    it('should check if keys exist', async () => {
      vi.mocked(mockRedis.exists).mockResolvedValue(2)

      const program = redisService.exists('key1', 'key2')
      const result = await Effect.runPromise(program)

      expect(result).toBe(2)
      expect(mockRedis.exists).toHaveBeenCalledWith('key1', 'key2')
    })

    it('should return 0 for non-existent keys', async () => {
      vi.mocked(mockRedis.exists).mockResolvedValue(0)

      const program = redisService.exists('missing-key')
      const result = await Effect.runPromise(program)

      expect(result).toBe(0)
    })
  })
  // TODO: Type 'RedisService' must have a 'Symbol.iterator' method that returns an iterator.
  //   describe('RedisServiceLive Layer', () => {
  //     it('should create a valid Layer', async () => {
  //       const layer = RedisServiceLive(mockRedis)

  //       const program = Effect.gen(function* () {
  //         const service = yield* redisService
  //         return service
  //       })

  //       // Layer should be composable
  //       expect(layer).toBeDefined()
  //     })
  //   })
})

describe('createOAuthRedisOps', () => {
  let mockRedis: Redis
  let redisService: ReturnType<typeof makeRedisService>
  let oauthOps: ReturnType<typeof createOAuthRedisOps>

  beforeEach(() => {
    mockRedis = createMockRedis()
    redisService = makeRedisService(mockRedis)
    oauthOps = createOAuthRedisOps(redisService)
  })

  describe('PKCE operations', () => {
    const TestSchema = Schema.Struct({
      codeVerifier: Schema.String,
      state: Schema.String,
    })

    it('should set and get PKCE state', async () => {
      const testData = { codeVerifier: 'test-verifier', state: 'test-state' }

      await Effect.runPromise(oauthOps.setPKCEState('session-123', testData, 300))

      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(testData))

      const result = await Effect.runPromise(oauthOps.getPKCEState('session-123', TestSchema))

      expect(result).toEqual(testData)
      expect(mockRedis.set).toHaveBeenCalledWith(
        'pkce_session:session-123',
        JSON.stringify(testData),
        'EX',
        300
      )
    })

    it('should delete PKCE state', async () => {
      vi.mocked(mockRedis.del).mockResolvedValue(1)

      const result = await Effect.runPromise(oauthOps.deletePKCEState('session-123'))

      expect(result).toBe(1)
      expect(mockRedis.del).toHaveBeenCalledWith('pkce_session:session-123')
    })
  })

  describe('Auth code operations', () => {
    const TestSchema = Schema.Struct({
      userId: Schema.String,
      scope: Schema.String,
    })

    it('should set and get auth code', async () => {
      const testData = { userId: 'user-123', scope: 'openid profile' }

      await Effect.runPromise(oauthOps.setAuthCode('code-abc', testData, 300))

      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(testData))

      const result = await Effect.runPromise(oauthOps.getAuthCode('code-abc', TestSchema))

      expect(result).toEqual(testData)
    })

    it('should use default TTL for auth codes', async () => {
      const testData = { userId: 'user-123', scope: 'openid' }

      await Effect.runPromise(oauthOps.setAuthCode('code-abc', testData))

      expect(mockRedis.set).toHaveBeenCalledWith(
        'auth_code:code-abc',
        JSON.stringify(testData),
        'EX',
        300
      )
    })

    it('should delete auth code', async () => {
      vi.mocked(mockRedis.del).mockResolvedValue(1)

      const result = await Effect.runPromise(oauthOps.deleteAuthCode('code-abc'))

      expect(result).toBe(1)
      expect(mockRedis.del).toHaveBeenCalledWith('auth_code:code-abc')
    })
  })

  describe('Auth code state operations', () => {
    const TestSchema = Schema.Struct({
      challenge: Schema.String,
    })

    it('should set and get auth code state', async () => {
      const testData = { challenge: 'test-challenge' }

      await Effect.runPromise(oauthOps.setAuthCodeState('code-abc', testData, 300))

      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(testData))

      const result = await Effect.runPromise(oauthOps.getAuthCodeState('code-abc', TestSchema))

      expect(result).toEqual(testData)
    })
  })

  describe('Refresh token operations', () => {
    const TestSchema = Schema.Struct({
      userId: Schema.String,
      tokenData: Schema.Unknown,
    })

    it('should set and get refresh token', async () => {
      const testData = { userId: 'user-123', tokenData: { access: 'token' } }

      await Effect.runPromise(oauthOps.setRefreshToken('refresh-xyz', testData, 86400))

      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(testData))

      const result = await Effect.runPromise(oauthOps.getRefreshToken('refresh-xyz', TestSchema))

      expect(result).toEqual(testData)
    })

    it('should use default 30-day TTL for refresh tokens', async () => {
      const testData = { userId: 'user-123', tokenData: {} }

      await Effect.runPromise(oauthOps.setRefreshToken('refresh-xyz', testData))

      expect(mockRedis.set).toHaveBeenCalledWith(
        'refresh_token:refresh-xyz',
        JSON.stringify(testData),
        'EX',
        60 * 60 * 24 * 30
      )
    })

    it('should delete refresh token', async () => {
      vi.mocked(mockRedis.del).mockResolvedValue(1)

      const result = await Effect.runPromise(oauthOps.deleteRefreshToken('refresh-xyz'))

      expect(result).toBe(1)
      expect(mockRedis.del).toHaveBeenCalledWith('refresh_token:refresh-xyz')
    })
  })
})
