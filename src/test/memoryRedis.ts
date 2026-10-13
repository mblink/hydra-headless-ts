/**
 * In-memory stand-in for ioredis, covering the commands fp/services/redis.ts uses.
 * Use it with `vi.mock('ioredis', () => import('./memoryRedis.js'))`.
 */
const store = new Map<string, string>();

export class Redis {
  async get(key: string) {
    return store.get(key) ?? null;
  }

  async set(key: string, value: string) {
    store.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]) {
    return keys.filter((key) => store.delete(key)).length;
  }

  async exists(...keys: string[]) {
    return keys.filter((key) => store.has(key)).length;
  }
}
