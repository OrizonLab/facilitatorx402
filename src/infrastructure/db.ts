import { PrismaClient } from '@prisma/client'
import { logger } from './logger.js'

// Singleton Prisma client — PostgreSQL only
export const db = new PrismaClient({
  log: [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
})

db.$on('error', (e) => logger.error({ msg: e.message, target: e.target }, 'prisma error'))
db.$on('warn',  (e) => logger.warn({ msg: e.message, target: e.target }, 'prisma warning'))

export async function checkDatabaseHealth(): Promise<'ok' | 'error'> {
  try {
    // Raw SQL ping — works on PostgreSQL only, intentionally
    await db.$queryRaw`SELECT 1`
    return 'ok'
  } catch (err: unknown) {
    logger.error({ err }, 'database health check failed')
    return 'error'
  }
}

export async function disconnectDb(): Promise<void> {
  await db.$disconnect()
}
