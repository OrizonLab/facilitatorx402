import Redis from 'ioredis'
import { config } from './config.js'

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
})

redis.on('error', (err: Error) => {
  console.error('[Redis] Connection error:', err.message)
})

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const result = await redis.ping()
    return result === 'PONG'
  } catch {
    return false
  }
}

/**
 * Acquire a distributed lock using SET NX EX.
 * Returns true if lock was acquired, false otherwise.
 */
export async function acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
  const lockKey = `lock:${key}`
  const result = await redis.set(lockKey, '1', 'EX', ttlSeconds, 'NX')
  return result === 'OK'
}

export async function releaseLock(key: string): Promise<void> {
  await redis.del(`lock:${key}`)
}
