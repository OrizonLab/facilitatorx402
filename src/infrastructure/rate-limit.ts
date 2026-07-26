/**
 * Rate limiting plugin for Fastify.
 *
 * Applied globally to all routes.
 * Stricter limits on /verify and /settle (payment-sensitive endpoints).
 *
 * Strategy:
 *   - Global: RATE_LIMIT_MAX req / RATE_LIMIT_WINDOW_MS per IP
 *   - /verify: 30 req/min per IP (anti-abuse on crypto operations)
 *   - /settle: 20 req/min per IP (idempotent but expensive)
 *
 * Uses @fastify/rate-limit with Redis store for distributed deployments.
 * Falls back to in-memory store if Redis is unavailable (dev/test only).
 */
import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { getConfig } from './config.js'
import { getRedis } from './redis.js'
import { logger } from './logger.js'

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  const config = getConfig()

  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    redis: getRedis(),
    keyGenerator: (request) => {
      // Use X-Forwarded-For if behind a proxy, fallback to IP
      const forwarded = request.headers['x-forwarded-for']
      const ip = Array.isArray(forwarded) ? forwarded[0] : (forwarded?.split(',')[0] ?? request.ip)
      return `ratelimit:global:${ip}`
    },
    errorResponseBuilder: (_request, context) => ({
      error: {
        code: 'rate_limit_exceeded',
        message: `Too many requests. Limit: ${context.max} per ${context.after}.`,
      },
    }),
    onExceeded: (request) => {
      logger.warn({ ip: request.ip, url: request.url }, 'rate limit exceeded')
    },
  })
}

/**
 * Per-route rate limit config for /verify (stricter).
 * Apply via: { config: { rateLimit: verifyRateLimit } }
 */
export const verifyRateLimit = {
  max: 30,
  timeWindow: '1 minute',
}

/**
 * Per-route rate limit config for /settle (stricter).
 */
export const settleRateLimit = {
  max: 20,
  timeWindow: '1 minute',
}
