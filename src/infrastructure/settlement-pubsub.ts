/**
 * Settlement pub/sub bridge — Redis → SSE
 *
 * The BullMQ settlement worker publishes status changes to Redis.
 * The SSE route subscribes and forwards events to connected clients.
 *
 * Channel format: settlement:{requestId}
 * Message format: JSON { status, txHash?, receiptId?, timestamp }
 *
 * PostgreSQL is the source of truth.
 * Redis is the real-time signaling layer only.
 */
import IORedis from 'ioredis'
import { logger } from './logger.js'

type EventCallback = (event: string, data: Record<string, unknown>) => void

// Dedicated subscriber connection (cannot be reused for commands)
let subscriber: IORedis | null = null
const listeners = new Map<string, Set<EventCallback>>()

export function getSubscriber(redisUrl: string): IORedis {
  if (!subscriber) {
    subscriber = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
      enableReadyCheck: true,
    })

    subscriber.on('message', (channel: string, message: string) => {
      const requestId = channel.replace('settlement:', '')
      const callbacks = listeners.get(requestId)
      if (!callbacks) return

      let data: Record<string, unknown>
      try {
        data = JSON.parse(message) as Record<string, unknown>
      } catch {
        logger.warn({ channel, message }, 'invalid pub/sub message')
        return
      }

      const event = String(data.status ?? 'settlement.update')
      for (const cb of callbacks) {
        try { cb(event, data) } catch { /* ignore broken SSE clients */ }
      }
    })

    subscriber.on('error', (err: unknown) => {
      logger.error({ err }, 'Redis subscriber error')
    })
  }
  return subscriber
}

export async function subscribeToSettlement(
  redisUrl: string,
  requestId: string,
  callback: EventCallback
): Promise<() => void> {
  const sub = getSubscriber(redisUrl)
  const channel = `settlement:${requestId}`

  if (!listeners.has(requestId)) {
    listeners.set(requestId, new Set())
    await sub.subscribe(channel)
    logger.debug({ requestId }, 'subscribed to settlement channel')
  }

  listeners.get(requestId)!.add(callback)

  // Returns an unsubscribe function
  return async () => {
    const cbs = listeners.get(requestId)
    if (!cbs) return
    cbs.delete(callback)
    if (cbs.size === 0) {
      listeners.delete(requestId)
      await sub.unsubscribe(channel)
      logger.debug({ requestId }, 'unsubscribed from settlement channel')
    }
  }
}

/**
 * Called by the BullMQ worker when settlement status changes.
 * Publishes to Redis so all SSE subscribers receive the update instantly.
 */
export async function publishSettlementUpdate(
  publisher: IORedis,
  requestId: string,
  update: {
    status: 'settlement.pending' | 'settlement.confirmed' | 'settlement.failed'
    txHash?: string
    receiptId?: string
    errorReason?: string
  }
): Promise<void> {
  const channel = `settlement:${requestId}`
  const message = JSON.stringify({ ...update, timestamp: new Date().toISOString() })
  await publisher.publish(channel, message)
  logger.debug({ requestId, status: update.status }, 'settlement update published')
}
