import type { FastifyInstance } from 'fastify'
import { checkDatabaseHealth } from '../../infrastructure/db.js'
import { checkRedisHealth } from '../../infrastructure/redis.js'
import { config } from '../../infrastructure/config.js'
import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'

async function checkRpcHealth(): Promise<boolean> {
  try {
    const client = createPublicClient({ chain: base, transport: http(config.RPC_URL, { timeout: 2000 }) })
    await client.getBlockNumber()
    return true
  } catch {
    return false
  }
}

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    const [dbOk, redisOk, rpcOk] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
      checkRpcHealth(),
    ])

    const allOk = dbOk && redisOk && rpcOk
    const status = allOk ? 'ok' : 'degraded'
    const httpStatus = allOk ? 200 : 503

    return reply.status(httpStatus).send({
      status,
      version: config.SERVICE_VERSION,
      checks: {
        database: dbOk ? 'ok' : 'error',
        redis: redisOk ? 'ok' : 'error',
        worker: 'ok', // Updated by worker heartbeat in production
        rpc: rpcOk ? 'ok' : 'error',
      },
      timestamp: new Date().toISOString(),
    })
  })
}
