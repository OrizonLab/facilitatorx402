/**
 * Fastify hook — records HTTP request duration for all routes.
 * Attach via app.addHook('onRequest', metricsOnRequest)
 *              app.addHook('onResponse', metricsOnResponse)
 */
import type { FastifyRequest, FastifyReply } from 'fastify'
import { httpRequestDuration } from './metrics.js'

export function metricsOnRequest(request: FastifyRequest, _reply: FastifyReply, done: () => void) {
  ;(request as any)._metricsStart = process.hrtime.bigint()
  done()
}

export function metricsOnResponse(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const start = (request as any)._metricsStart as bigint | undefined
  if (start) {
    const durationNs = process.hrtime.bigint() - start
    const durationSeconds = Number(durationNs) / 1e9
    httpRequestDuration.observe(
      {
        method: request.method,
        route: request.routeOptions?.url ?? request.url,
        status_code: String(reply.statusCode),
      },
      durationSeconds
    )
  }
  done()
}
