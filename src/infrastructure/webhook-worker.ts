/**
 * Webhook delivery worker — BullMQ queue backed by Redis.
 *
 * When a settlement status changes, the settlement worker enqueues
 * a webhook delivery job. This worker picks it up, dispatches to
 * the subscriber URL, and persists the result in PostgreSQL.
 *
 * Retry schedule (stored in PostgreSQL webhook_deliveries):
 *   attempt 1: immediate
 *   attempt 2: +5s
 *   attempt 3: +30s
 *   attempt 4: +2min
 *   attempt 5: +10min
 *
 * After 5 failures, the delivery is marked as failed in PostgreSQL.
 * No data is lost — PostgreSQL is the delivery audit trail.
 */
import { Worker, Queue, type Job } from 'bullmq'
import IORedis from 'ioredis'
import { ulid } from 'ulid'
import { db } from './db.js'
import { dispatchWebhook } from './webhook-dispatcher.js'
import { logger } from './logger.js'

export const WEBHOOK_QUEUE = 'webhook-delivery'

export interface WebhookJobData {
  event: string
  requestId: string
  settlementId?: string
  txHash?: string
  receiptId?: string
  errorReason?: string
  sellerId?: string
}

export function createWebhookQueue(connection: IORedis): Queue<WebhookJobData> {
  return new Queue<WebhookJobData>(WEBHOOK_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    },
  })
}

export function startWebhookWorker(connection: IORedis): Worker<WebhookJobData> {
  const worker = new Worker<WebhookJobData>(
    WEBHOOK_QUEUE,
    async (job: Job<WebhookJobData>) => {
      const { event, requestId, sellerId, ...eventData } = job.data

      // Find active webhook subscriptions for this seller
      const subscriptions = await db.webhookSubscription.findMany({
        where: {
          active: true,
          ...(sellerId ? { sellerId } : {}),
          events: { has: event }, // PostgreSQL array contains
        },
      })

      if (subscriptions.length === 0) {
        logger.debug({ event, requestId }, 'no webhook subscribers for event')
        return
      }

      for (const sub of subscriptions) {
        const deliveryId = ulid()

        // Persist delivery attempt in PostgreSQL
        await db.webhookDelivery.create({
          data: {
            id: deliveryId,
            subscriptionId: sub.id,
            event,
            payload: { requestId, ...eventData },
            attempt: job.attemptsMade + 1,
            status: 'pending',
          },
        })

        const result = await dispatchWebhook(
          { subscriptionId: sub.id, url: sub.url, secret: sub.secret, events: sub.events },
          event,
          { requestId, ...eventData }
        )

        // Update delivery status in PostgreSQL
        await db.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: result.delivered ? 'delivered' : 'failed',
            httpStatus: result.httpStatus,
            responseBody: result.error,
            deliveredAt: result.delivered ? new Date() : null,
          },
        })

        if (result.delivered) {
          logger.info({ event, subscriptionId: sub.id, requestId }, 'webhook delivered')
        } else {
          logger.warn({ event, subscriptionId: sub.id, requestId, error: result.error }, 'webhook delivery failed')
          // Re-throw to trigger BullMQ retry
          if (job.attemptsMade < 4) throw new Error(result.error ?? 'delivery failed')
        }
      }
    },
    {
      connection,
      concurrency: 10,
    }
  )

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, event: job?.data.event, err }, 'webhook job failed')
  })

  return worker
}
