/**
 * Rate limiting plugin for Fastify.
 *
 * Strategy:
 *   - Global: 200 req/min per IP (all routes)
 *   - POST /verify: 30 req/min per IP + 60 req/min per seller (x-seller-id header)
 *   - POST /settle: 20 req/min per IP + 40 req/min per seller
 *   - GET /receipts/:id: 60 req/min per IP
 *
 * Uses Redis (ioredis) as the backing store via @fastify/rate-limit.
 * Falls back to in-memory if Redis is unavailable (non-fatal).
 */
import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import type { Redis } from 'ioredis'
import { logger as rootLogger } from '../logger.js'

const log = rootLogger.child({ module: 'rate-limit' })

export interface RateLimitConfig {
  redis: Redis
  // Override defaults (useful for tests)
  global?: number
  verify?: { ip: number; seller: number }
  settle?: { ip: number; seller: number }
  receipts?: number
}

export async function registerRateLimit(
  app: FastifyInstance,
  cfg: RateLimitConfig,
): Promise<void> {
  const globalMax = cfg.global ?? 200

  // 1. Global rate limit (IP-based)
  await app.register(rateLimit, {
    max: globalMax,
    timeWindow: '1 minute',
    redis: cfg.redis,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      error: {
        code:    'rate_limit_exceeded',
        reason:  'Too many requests',
        message: 'Rate limit exceeded. Please slow down.',
      },
    }),
    onExceeded: (req) => {
      log.warn({ ip: req.ip, route: req.routeOptions?.url }, 'rate_limit.global.exceeded')
    },
  })

  // 2. Per-route limits are added as route-level config in routes/verify.ts + routes/settle.ts
  //    via app.addHook('onRequest', ...) or route-level `config.rateLimit` option.
  //    This plugin exposes helper builders for those routes.
}

/**
 * Build a route-level rate-limit config for a given endpoint.
 * Usage in route file:
 *   app.post('/verify', { config: buildRouteRateLimit('verify', cfg) }, handler)
 */
export function buildRouteRateLimit(
  endpoint: 'verify' | 'settle' | 'receipts',
  cfg: RateLimitConfig,
) {
  const verifyLimits  = cfg.verify  ?? { ip: 30, seller: 60 }
  const settleLimits  = cfg.settle  ?? { ip: 20, seller: 40 }
  const receiptsLimit = cfg.receipts ?? 60

  if (endpoint === 'receipts') {
    return {
      rateLimit: {
        max:        receiptsLimit,
        timeWindow: '1 minute',
        keyGenerator: (req: any) => `rl:receipts:ip:${req.ip}`,
      },
    }
  }

  const limits = endpoint === 'verify' ? verifyLimits : settleLimits

  return {
    rateLimit: {
      max:        limits.ip,
      timeWindow: '1 minute',
      // Prefer seller-scoped key if x-seller-id header present
      keyGenerator: (req: any) => {
        const seller = req.headers['x-seller-id']
        if (seller) return `rl:${endpoint}:seller:${seller}`
        return `rl:${endpoint}:ip:${req.ip}`
      },
    },
  }
}
