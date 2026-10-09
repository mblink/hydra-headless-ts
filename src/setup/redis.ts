/**
 * Shared Redis connection used by the app's service layer and the Hydra proxy
 */
import { Redis } from 'ioredis'
import { appConfig } from '../config.js'

export const redisClient = new Redis({
  host: appConfig.redisHost,
  port: appConfig.redisPort,
  // ioredis 6 defaults to RESP3, which fails on Redis < 6; keep the v5 wire protocol
  protocol: 2,
})
