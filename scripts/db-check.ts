/**
 * db-check.ts — Verify PostgreSQL connection before starting the service.
 * Called by Docker entrypoint / CI pipeline.
 * Exits with code 1 if DATABASE_URL is not PostgreSQL or DB is unreachable.
 */
import { PrismaClient } from '@prisma/client'

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? ''

  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    console.error('FATAL: DATABASE_URL must be a PostgreSQL connection string.')
    console.error('  Got:', url.slice(0, 30) + '...')
    console.error('  SQLite is not supported in facilitatorx402.')
    process.exit(1)
  }

  const prisma = new PrismaClient({ log: ['error'] })

  try {
    await prisma.$queryRaw`SELECT 1 AS ok`
    console.log('✓ PostgreSQL connection OK')
    console.log('  URL:', url.replace(/:([^@]+)@/, ':***@'))
  } catch (err) {
    console.error('FATAL: Cannot connect to PostgreSQL:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
