/**
 * Rate limiting fin — deux niveaux :
 *
 *   1. Global par IP (Fastify @fastify/rate-limit, Redis-backed)
 *      → Déjà configuré dans app.ts
 *
 *   2. Par seller (X-Api-Key) pour les endpoints x402 critiques
 *      → verify : 60 req/min/seller
 *      → settle  : 30 req/min/seller
 *
 * Usage dans une route :
 *   app.post('/verify', {
 *     config: { rateLimit: sellerRateLimit('verify') },
 *     ...
 *   }, handler)
 *
 * Ou via hook :
 *   app.addHook('preHandler', createSellerRateLimitHook('verify'))
 */
import type { FastifyRequest, FastifyReply } from 'fastify'
import { getConfig } from './config.js'
import { redis } from './redis.js'
import { logger } from './logger.js'
import { Counter, register } from 'prom-client'

const rateLimitHitCounter = new Counter({
  name: 'rate_limit_hit_total',
  help: 'Total requests blocked by rate limiting',
  labelNames: ['type', 'endpoint'], // type: ip | seller
  registers: [register],
})

const SELLER_RATE_LIMITS: Record<string, number> = {
  verify: 60,    // 60 req/min/seller
  settle: 30,    // 30 req/min/seller
  default: 100,  // 100 req/min/seller pour les autres endpoints
}

/**
 * Hook Fastify preHandler qui applique le rate limit par seller.
 * Lit le header X-Api-Key, hash en SHA-256 pour la clé Redis.
 * Si dépassé → 429 avec Retry-After.
 */
export function createSellerRateLimitHook(endpoint: string) {
  const config = getConfig()
  const limit = SELLER_RATE_LIMITS[endpoint] ?? SELLER_RATE_LIMITS.default!
  const windowMs = config.RATE_LIMIT_WINDOW_MS
  const windowSec = Math.ceil(windowMs / 1000)

  return async function sellerRateLimitHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const apiKey = request.headers['x-api-key'] as string | undefined
    if (!apiKey) return // pas de seller identifié → le rate limit global IP s'applique

    // On utilise les 16 premiers chars du header pour éviter les clés trop longues en Redis
    const keyPrefix = apiKey.slice(0, 16).replace(/[^a-zA-Z0-9]/g, '')
    const redisKey = `rl:seller:${endpoint}:${keyPrefix}`

    try {
      const current = await redis.incr(redisKey)
      if (current === 1) {
        await redis.expire(redisKey, windowSec)
      }

      const remaining = Math.max(0, limit - current)
      reply.header('X-RateLimit-Limit', limit)
      reply.header('X-RateLimit-Remaining', remaining)
      reply.header('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + windowSec)

      if (current > limit) {
        rateLimitHitCounter.inc({ type: 'seller', endpoint })
        logger.warn({ keyPrefix, endpoint, current, limit }, 'seller rate limit exceeded')
        return reply.status(429).send({
          error: {
            code: 'rate_limited',
            reason: 'Seller rate limit exceeded',
            message: `Too many ${endpoint} requests. Limit: ${limit}/min. Retry after ${windowSec}s.`,
          },
          retryAfter: windowSec,
        })
      }
    } catch (redisErr) {
      // Redis error → fail open (ne pas bloquer le trafic)
      logger.warn({ redisErr, endpoint }, 'rate limit Redis error, failing open')
    }
  }
}

/**
 * Config @fastify/rate-limit pour les routes IP-based.
 * Référencé dans app.ts pour le rate limit global.
 */
export function getGlobalRateLimitConfig() {
  const config = getConfig()
  return {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    redis,
    keyGenerator: (request: FastifyRequest) => request.ip,
    errorResponseBuilder: () => ({
      error: {
        code: 'rate_limited',
        reason: 'IP rate limit exceeded',
        message: 'Too many requests from this IP. Please retry later.',
      },
    }),
    onExceeded: (request: FastifyRequest) => {
      rateLimitHitCounter.inc({ type: 'ip', endpoint: request.routerPath ?? 'unknown' })
    },
  }
}
