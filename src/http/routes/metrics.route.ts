/**
 * GET /metrics
 *
 * Exposes Prometheus metrics for scraping.
 * Secured by optional METRICS_TOKEN env var (Bearer token).
 *
 * Metrics exposed:
 *   - http_request_duration_seconds (histogram, by method + route + status)
 *   - verify_total (counter, by status: accepted|rejected)
 *   - verify_duration_seconds (histogram p50/p95)
 *   - settle_total (counter, by status: confirmed|failed|pending)
 *   - settle_duration_seconds (histogram p50/p95)
 *   - duplicate_blocked_total (counter, by type: nonce|signature|settlement)
 *   - commission_generated_total (counter, USDC units)
 *   - developer_share_total (counter, USDC units)
 *   - bullmq_queue_depth (gauge)
 *   - rpc_errors_total (counter)
 */
import type { FastifyInstance } from 'fastify'
import { register } from 'prom-client'
import { getConfig } from '../../infrastructure/config.js'
import { logger } from '../../infrastructure/logger.js'

export async function registerMetricsRoute(app: FastifyInstance): Promise<void> {
  app.get('/metrics', {
    schema: {
      tags: ['observability'],
      summary: 'Prometheus metrics endpoint',
      description: 'Returns all Prometheus metrics in text/plain exposition format.',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const config = getConfig()

    // Optional bearer token protection
    if (config.METRICS_TOKEN) {
      const authHeader = request.headers.authorization ?? ''
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
      if (token !== config.METRICS_TOKEN) {
        return reply.status(401).send({ error: { code: 'unauthorized', message: 'Invalid metrics token' } })
      }
    }

    try {
      const metrics = await register.metrics()
      return reply
        .status(200)
        .header('Content-Type', register.contentType)
        .send(metrics)
    } catch (err: any) {
      logger.error({ err }, 'metrics collection error')
      return reply.status(500).send('# metrics collection error')
    }
  })
}
