/**
 * GET /metrics — Prometheus metrics endpoint.
 *
 * Protected by METRICS_TOKEN (Bearer auth).
 * Uses timingSafeEqual to prevent timing attacks on the token comparison.
 *
 * The token is validated via the shared safeEqual helper.
 * A missing or incorrect token returns 401 with no metrics payload.
 */
import type { FastifyInstance } from 'fastify'
import { register } from '../../infrastructure/metrics.js'
import { getConfig } from '../../infrastructure/config.js'
import { safeEqual } from '../../infrastructure/safe-compare.js'

export async function metricsRoute(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (request, reply) => {
    const config = getConfig()
    const auth = (request.headers['authorization'] ?? '') as string
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''

    if (!safeEqual(token, config.METRICS_TOKEN)) {
      return reply
        .status(401)
        .header('WWW-Authenticate', 'Bearer realm="facilitatorx402 metrics"')
        .send({
          error: {
            code: 'unauthorized',
            reason: 'Missing or invalid metrics token',
            message: 'Provide Authorization: Bearer <METRICS_TOKEN>',
          },
        })
    }

    const metrics = await register.metrics()
    return reply
      .header('Content-Type', register.contentType)
      .send(metrics)
  })
}
