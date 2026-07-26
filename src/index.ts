/**
 * facilitatorx402 — Entry point
 *
 * Boot sequence:
 *   1. Validate config (PostgreSQL URL enforced)
 *   2. Connect Prisma to PostgreSQL
 *   3. Load NetworkRegistry from PostgreSQL
 *   4. Start NetworkRegistry auto-reload (every 60s)
 *   5. Start Fastify with all routes
 *   6. Start BullMQ workers
 *   7. Graceful shutdown on SIGTERM / SIGINT
 */
import Fastify from 'fastify'
import { getConfig } from './infrastructure/config.js'
import { db } from './infrastructure/db.js'
import { networkRegistry } from './infrastructure/network-registry.js'
import { createRedis } from './infrastructure/redis.js'
import { logger } from './infrastructure/logger.js'
import { registerHealthRoute } from './http/routes/health.route.js'
import { registerSupportedRoute } from './http/routes/supported.route.js'
import { registerAdminRoutes } from './http/routes/admin.route.js'
import { registerSellersRoutes } from './http/routes/sellers.route.js'
import { startWebhookWorker, createWebhookQueue } from './infrastructure/webhook-worker.js'

async function bootstrap(): Promise<void> {
  const config = getConfig()

  // --- 1. PostgreSQL check ---
  logger.info('Connecting to PostgreSQL...')
  await db.$connect()
  logger.info('PostgreSQL connected')

  // --- 2. NetworkRegistry: load from PostgreSQL ---
  logger.info('Loading NetworkRegistry from PostgreSQL...')
  await networkRegistry.load()
  networkRegistry.startAutoReload()

  // --- 3. Redis ---
  const redisConnection = createRedis()
  const webhookQueue = createWebhookQueue(redisConnection)
  const webhookWorker = startWebhookWorker(redisConnection)

  // --- 4. Fastify ---
  const app = Fastify({
    logger: false, // We use pino directly
    trustProxy: true,
    disableRequestLogging: false,
  })

  // Request logging via hook
  app.addHook('onRequest', async (request) => {
    logger.info({ method: request.method, url: request.url, requestId: request.id }, 'incoming request')
  })

  app.addHook('onResponse', async (request, reply) => {
    logger.info(
      { method: request.method, url: request.url, statusCode: reply.statusCode, responseTime: reply.elapsedTime },
      'request completed'
    )
  })

  // Register routes
  await app.register(registerHealthRoute)
  await app.register(registerSupportedRoute)
  await app.register(registerAdminRoutes)
  await app.register(registerSellersRoutes)

  // --- 5. Start server ---
  await app.listen({ port: config.PORT, host: config.HOST })
  logger.info({ port: config.PORT, host: config.HOST }, 'facilitatorx402 started')

  // --- 6. Graceful shutdown ---
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down...')
    await app.close()
    networkRegistry.stopAutoReload()
    await webhookWorker.close()
    await webhookQueue.close()
    await redisConnection.quit()
    await db.$disconnect()
    logger.info('shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

bootstrap().catch((err) => {
  logger.error({ err }, 'bootstrap failed')
  process.exit(1)
})
