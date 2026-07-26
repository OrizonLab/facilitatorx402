/**
 * BullMQ queue factory and job helpers.
 *
 * Queues defined:
 *   - settlement  : on-chain tx submission + confirmation tracking
 *   - webhook     : outbound HTTP delivery with HMAC-SHA256 signature
 *
 * Usage:
 *   import { enqueueWebhook } from '../infrastructure/queue.js'
 *   await enqueueWebhook({ deliveryId, url, secret, event, payload })
 */
import { Queue } from 'bullmq'
import { redis } from './redis.js'

// ── Settlement queue ──────────────────────────────────────────────────────────
export const settlementQueue = new Queue('settlement', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
})

// ── Webhook queue ─────────────────────────────────────────────────────────────
export const webhookQueue = new Queue('webhook', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 2000 },
    removeOnFail: { count: 10000 },
  },
})

export interface WebhookJobData {
  deliveryId: string
  url: string
  secret: string
  event: string
  payload: Record<string, unknown>
  sellerId: string
  attempt: number
}

/**
 * Enqueue a webhook delivery job.
 * Called by webhook.service.ts after creating the WebhookDelivery record.
 */
export async function enqueueWebhook(data: WebhookJobData): Promise<void> {
  await webhookQueue.add(`webhook:${data.event}:${data.deliveryId}`, data, {
    jobId: data.deliveryId, // idempotent — same deliveryId = same job
  })
}
