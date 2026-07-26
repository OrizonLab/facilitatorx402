/**
 * Webhook queue V2 — BullMQ job enqueue for seller webhook delivery.
 *
 * Events pushed to queue:
 *   - payment.verified   (after POST /verify accepted)
 *   - payment.settled    (after POST /settle confirmed)
 *   - payment.failed     (after POST /settle failed)
 *
 * Each job:
 *   - Signed with HMAC-SHA256 (X-Webhook-Signature header)
 *   - Retried up to 5 times with exponential backoff
 *   - Dead-letter queue after max retries
 *
 * The worker (webhook-worker.ts) processes jobs and delivers via HTTP POST.
 */
import { Queue } from 'bullmq'
import { getRedis } from './redis.js'
import { logger } from './logger.js'

export type WebhookEventType = 'payment.verified' | 'payment.settled' | 'payment.failed'

export interface WebhookPayload {
  event: WebhookEventType
  requestId: string
  verificationId?: string
  settlementId?: string
  txHash?: string
  receiptId?: string
  network?: string
  asset?: string
  amount?: string
  feeAmount?: string
  sellerId?: string
  timestamp: string
}

export interface WebhookJob {
  webhookUrl: string
  webhookSecret: string
  payload: WebhookPayload
  attemptsMade?: number
}

let _webhookQueue: Queue | null = null

export function getWebhookQueue(): Queue {
  if (!_webhookQueue) {
    _webhookQueue = new Queue('webhooks', {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2_000, // 2s, 4s, 8s, 16s, 32s
        },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    })
  }
  return _webhookQueue
}

export async function enqueueWebhook(
  sellerId: string,
  webhookUrl: string,
  webhookSecret: string,
  payload: WebhookPayload
): Promise<void> {
  if (!webhookUrl) {
    logger.debug({ sellerId, event: payload.event }, 'no webhook URL configured for seller, skipping')
    return
  }

  const queue = getWebhookQueue()
  const jobId = `${payload.event}:${payload.requestId}:${Date.now()}`

  await queue.add(
    payload.event,
    { webhookUrl, webhookSecret, payload } satisfies WebhookJob,
    { jobId }
  )

  logger.info({ sellerId, event: payload.event, requestId: payload.requestId, jobId }, 'webhook enqueued')
}
