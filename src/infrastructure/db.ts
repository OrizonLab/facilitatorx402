/**
 * Prisma client singleton — PostgreSQL only.
 * The DATABASE_URL is validated in config.ts before this module is used.
 */
import { PrismaClient } from '@prisma/client'
import { logger } from './logger.js'

declare global {
  // Prevent multiple instances during hot reload in development
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

function buildClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { level: 'query', emit: 'event' },
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  })

  if (process.env.LOG_LEVEL === 'trace') {
    client.$on('query', (e) => {
      logger.trace({ query: e.query, params: e.params, duration: e.duration }, 'prisma query')
    })
  }

  client.$on('warn', (e) => logger.warn({ message: e.message }, 'prisma warning'))
  client.$on('error', (e) => logger.error({ message: e.message }, 'prisma error'))

  return client
}

export const db: PrismaClient =
  globalThis.__prisma ?? (globalThis.__prisma = buildClient())
