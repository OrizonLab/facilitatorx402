import { beforeAll, afterAll } from 'vitest'
import { prisma } from '../infrastructure/db.js'
import { redis } from '../infrastructure/redis.js'

beforeAll(async () => {
  await redis.connect().catch(() => { /* already connected */ })
})

afterAll(async () => {
  await prisma.$disconnect()
  await redis.quit().catch(() => { /* ignore */ })
})
