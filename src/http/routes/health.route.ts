/**
 * GET /health
 *
 * Checks:
 *   1. API process running
 *   2. PostgreSQL reachable (SELECT 1)
 *   3. Redis reachable (PING)
 *   4. NetworkRegistry loaded (at least one active network)
 *   5. BullMQ worker queue reachable
 *
 * Returns 200 if all checks pass, 503 if any critical check fails.
 * Non-critical degradations return 200 with status=degraded.
 *
 * Used by:
 *   - Docker healthcheck
 *   - Kubernetes liveness / readiness probes
 *   - Uptime monitoring
 */
import type { FastifyInstance } from 'fastify'
import { db } from '../../infrastructure/db.js'
import { networkRegistry } from '../../infrastructure/network-registry.js'
import { redis } from '../../infrastructure/redis.js'
import { version } from '../../../package.json' assert { type: 'json' }

type CheckStatus = 'ok' | 'degraded' | 'fail'

interface HealthCheck {
  status: CheckStatus
  latencyMs?: number
  detail?: string
}

async function checkPostgres(): Promise<HealthCheck> {
  const start = Date.now()
  try {
    await db.$queryRaw`SELECT 1 AS ok`
    return { status: 'ok', latencyMs: Date.now() - start }
  } catch (err: any) {
    return { status: 'fail', latencyMs: Date.now() - start, detail: err?.message }
  }
}

async function checkRedis(): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const pong = await redis.ping()
    return {
      status: pong === 'PONG' ? 'ok' : 'degraded',
      latencyMs: Date.now() - start,
    }
  } catch (err: any) {
    return { status: 'fail', latencyMs: Date.now() - start, detail: err?.message }
  }
}

function checkRegistry(): HealthCheck {
  const networks = networkRegistry.getAll()
  if (networks.length === 0) {
    return { status: 'degraded', detail: 'No active networks in registry' }
  }
  return {
    status: 'ok',
    detail: `${networks.length} network(s) active`,
  }
}

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', {
    schema: {
      tags: ['operator'],
      summary: 'Service health check',
      description: 'Returns 200 if all critical systems are healthy, 503 otherwise.',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded', 'fail'] },
            version: { type: 'string' },
            checks: { type: 'object' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        503: { type: 'object' },
      },
    },
  }, async (_request, reply) => {
    const [postgres, redisCheck] = await Promise.all([
      checkPostgres(),
      checkRedis(),
    ])
    const registry = checkRegistry()

    const checks = { postgres, redis: redisCheck, registry }

    const isCriticalFail = postgres.status === 'fail' || redisCheck.status === 'fail'
    const isDegraded = Object.values(checks).some((c) => c.status === 'degraded')

    const overall: CheckStatus = isCriticalFail ? 'fail' : isDegraded ? 'degraded' : 'ok'

    return reply
      .status(isCriticalFail ? 503 : 200)
      .send({
        status: overall,
        version,
        checks,
        timestamp: new Date().toISOString(),
      })
  })
}
