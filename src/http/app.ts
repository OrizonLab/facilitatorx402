import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { config } from '../infrastructure/config.js'
import { redis } from '../infrastructure/redis.js'
import { logger } from '../infrastructure/logger.js'
import { errorHandler } from './error-handler.js'
import { healthRoute } from './routes/health.js'
import { supportedRoute } from './routes/supported.js'
import { metricsRoute } from './routes/metrics.js'
import { verifyRoute } from './routes/verify.js'
import { settleRoute } from './routes/settle.js'
import { receiptsRoute } from './routes/receipts.js'

export async function buildApp() {
  const app = Fastify({
    logger: logger as Parameters<typeof Fastify>[0]['logger'],
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    disableRequestLogging: false,
    bodyLimit: 65536, // 64KB max body
  })

  // Rate limiting backed by Redis
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_GLOBAL,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: () => ({
      error: {
        code: 'rate_limited',
        reason: 'Too many requests',
        message: 'Rate limit exceeded. Please retry later.',
      },
    }),
  })

  // Error handler
  app.setErrorHandler(errorHandler)

  // Routes
  await app.register(healthRoute)
  await app.register(supportedRoute)
  await app.register(metricsRoute)
  await app.register(verifyRoute)
  await app.register(settleRoute)
  await app.register(receiptsRoute)

  return app
}
