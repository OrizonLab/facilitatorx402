import type { FastifyInstance } from 'fastify'
import { register } from '../../infrastructure/metrics.js'

export async function metricsRoute(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_request, reply) => {
    const metrics = await register.metrics()
    return reply
      .header('Content-Type', register.contentType)
      .send(metrics)
  })
}
