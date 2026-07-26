/**
 * GET /settlements/:id/stream
 *
 * Server-Sent Events — real-time settlement status via Redis pub/sub.
 * PostgreSQL is the source of truth; Redis is the signaling layer.
 *
 * Usage (browser / agent / robot):
 * ```js
 * const es = new EventSource('/settlements/req_01J.../stream')
 * es.addEventListener('settlement.confirmed', (e) => {
 *   const { txHash, receiptId } = JSON.parse(e.data)
 *   es.close()
 * })
 * ```
 */
import type { FastifyInstance } from 'fastify'
import { subscribeToSettlement } from '../../infrastructure/settlement-pubsub.js'
import { getConfig } from '../../infrastructure/config.js'
import { db } from '../../infrastructure/db.js'
import { logger } from '../../infrastructure/logger.js'

const TERMINAL_EVENTS = new Set(['settlement.confirmed', 'settlement.failed'])
const STREAM_TIMEOUT_MS = 5 * 60 * 1000
const HEARTBEAT_INTERVAL_MS = 15_000

export async function registerSseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settlements/:id/stream', {
    schema: {
      tags: ['payments'],
      summary: 'Real-time settlement status via SSE',
      description: [
        'Server-Sent Events stream backed by Redis pub/sub.',
        'PostgreSQL is the source of truth — Redis is the signaling layer only.',
        '',
        '**On connect:** the current DB status is sent immediately.',
        'If already in a terminal state (confirmed/failed), the stream closes right away.',
        '',
        '**Events:**',
        '- `settlement.pending` — Transaction submitted',
        '- `settlement.confirmed` — Confirmed on-chain (terminal)',
        '- `settlement.failed` — Transaction failed (terminal)',
        '',
        'The stream closes automatically after a terminal event.',
        'Heartbeat every 15s keeps the connection alive through nginx proxies.',
      ].join('\n'),
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'Payment request ID' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const config = getConfig()

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const send = (event: string, data: unknown) => {
      if (reply.raw.writableEnded) return
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const close = () => {
      if (!reply.raw.writableEnded) reply.raw.end()
    }

    // 1. Check current DB state first (PostgreSQL source of truth)
    const settlement = await db.paymentSettlement.findUnique({
      where: { requestId: id },
      select: { settlementStatus: true, txHash: true, confirmedAt: true },
    })

    if (settlement) {
      const statusMap = { confirmed: 'settlement.confirmed', failed: 'settlement.failed', pending: 'settlement.pending' }
      const event = statusMap[settlement.settlementStatus]
      send(event, {
        requestId: id,
        status: settlement.settlementStatus,
        txHash: settlement.txHash,
        confirmedAt: settlement.confirmedAt?.toISOString(),
        source: 'db',
      })
      if (settlement.settlementStatus !== 'pending') {
        close()
        return
      }
    }

    // 2. Subscribe to Redis pub/sub for live updates
    const heartbeat = setInterval(() => {
      if (reply.raw.writableEnded) { clearInterval(heartbeat); return }
      reply.raw.write(': heartbeat\n\n')
    }, HEARTBEAT_INTERVAL_MS)

    const timeout = setTimeout(() => {
      clearInterval(heartbeat)
      send('timeout', { message: 'Stream timeout. Poll GET /receipts/:id for final status.' })
      close()
    }, STREAM_TIMEOUT_MS)

    const unsubscribe = await subscribeToSettlement(
      config.REDIS_URL,
      id,
      (event, data) => {
        send(event, { ...data, requestId: id, source: 'realtime' })
        if (TERMINAL_EVENTS.has(event)) {
          clearInterval(heartbeat)
          clearTimeout(timeout)
          setTimeout(close, 100) // flush before close
        }
      }
    )

    request.raw.on('close', () => {
      clearInterval(heartbeat)
      clearTimeout(timeout)
      unsubscribe().catch(() => {})
      logger.debug({ requestId: id }, 'SSE client disconnected')
    })
  })
}
