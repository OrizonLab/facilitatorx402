/**
 * Redis singleton — IORedis client.
 * Used by BullMQ queues and the NetworkRegistry background reload.
 */
import IORedis from 'ioredis'
import { getConfig } from './config.js'
import { logger } from './logger.js'

let _redis: IORedis | null = null

export function createRedis(): IORedis {
  const config = getConfig()
  const client = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    lazyConnect: false,
  })

  client.on('connect', () => logger.info('Redis connected'))
  client.on('error', (err) => logger.error({ err }, 'Redis error'))
  client.on('close', () => logger.warn('Redis connection closed'))

  return client
}

export function getRedis(): IORedis {
  if (!_redis) _redis = createRedis()
  return _redis
}

/** Used by health.route.ts for lightweight check */
export const redis = {
  ping: async (): Promise<string> => getRedis().ping(),
}
