import { buildApp } from './http/app.js'
import { prisma } from './infrastructure/db.js'
import { redis } from './infrastructure/redis.js'
import { config } from './infrastructure/config.js'
import { logger } from './infrastructure/logger.js'
import { startSettlementWorker } from './infrastructure/workers/confirm-settlement.worker.js'

async function main(): Promise<void> {
  // Connect to Redis eagerly
  await redis.connect()
  logger.info('Redis connected')

  // Run DB migrations in production (optional — use deploy command in CD)
  // await prisma.$connect() is called lazily

  // Start BullMQ worker
  startSettlementWorker()

  // Build Fastify app
  const app = await buildApp()

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down...')
    await app.close()
    await prisma.$disconnect()
    await redis.quit()
    logger.info('Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  // Start listening
  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  logger.info({ port: config.PORT, version: config.SERVICE_VERSION }, 'facilitatorx402 started')
}

main().catch((err: unknown) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
