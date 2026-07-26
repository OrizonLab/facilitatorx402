import type { FastifyInstance } from 'fastify'
import { logger } from '../../infrastructure/logger.js'

/**
 * GET /settlements/:id/stream
 *
 * Server-Sent Events endpoint for real-time settlement status.
 * Critical for AI agents and robots that need confirmation without polling.
 *
 * Usage:
 * ```js
 * const es = new EventSource('/settlements/req_123/stream')
 * es.addEventListener('settlement.confirmed', (e) => {
 *   const { txHash, receiptId } = JSON.parse(e.data)
 *   es.close()
 * })
 * ```
 */
export async function registerSseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settlements/:id/stream', {
    schema: {
      tags: ['payments'],
      summary: 'Stream settlement status via SSE',
      description: [
        'Server-Sent Events stream for real-time settlement status updates.',
        '',
        'Connect once, receive events as they occur:',
        '- `settlement.pending` — Transaction submitted to the network',
        '- `settlement.confirmed` — Transaction confirmed on-chain',
        '- `settlement.failed` — Transaction failed',
        '',
        'The stream closes automatically after a terminal event (confirmed/failed).',
        'Ideal for AI agents and autonomous robots that need instant feedback.',
      ].join('\n'),
      params: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Request ID or settlement ID' } },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    })

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    // Heartbeat every 15s to keep connection alive through proxies/robots
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n')
    }, 15_000)

    // Timeout after 5 minutes if no terminal event
    const timeout = setTimeout(() => {
      clearInterval(heartbeat)
      send('timeout', { message: 'Stream timed out, please poll GET /receipts/:id' })
      reply.raw.end()
    }, 5 * 60 * 1000)

    // TODO: Subscribe to Redis pub/sub channel `settlement:${id}`
    // When the worker publishes a status change, forward it here.
    // For now, send a stub pending event.
    send('settlement.pending', { requestId: id, status: 'pending', timestamp: new Date().toISOString() })

    request.raw.on('close', () => {
      clearInterval(heartbeat)
      clearTimeout(timeout)
      logger.debug({ requestId: id }, 'SSE client disconnected')
    })
  })
}
