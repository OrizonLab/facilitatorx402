/**
 * BullMQ worker — outbound webhook delivery.
 *
 * For each job:
 *   1. Serialize payload to JSON
 *   2. Sign with HMAC-SHA256 using the seller's webhook secret
 *   3. POST to the seller's webhook URL
 *   4. Update WebhookDelivery status in DB (delivered / failed)
 *
 * Signature header: X-Facilitator-Signature: sha256=<hex>
 * Timestamp header:  X-Facilitator-Timestamp: <unix_ms>
 *
 * The seller can verify authenticity:
 *   const expected = createHmac('sha256', secret)
 *     .update(`${timestamp}.${body}`)
 *     .digest('hex')
 *   if (expected !== sig.replace('sha256=', '')) throw new Error('Invalid signature')
 */
import { Worker } from 'bullmq'
import { createHmac } from 'node:crypto'
import { redis } from '../redis.js'
import { prisma } from '../prisma.js'
import { logger } from '../logger.js'
import type { WebhookJobData } from '../queue.js'

const WEBHOOK_TIMEOUT_MS = 10_000 // 10s timeout per delivery

export const webhookWorker = new Worker<WebhookJobData>(
  'webhook',
  async (job) => {
    const { deliveryId, url, secret, event, payload, sellerId } = job.data

    const timestamp = Date.now().toString()
    const body = JSON.stringify({ event, payload, timestamp: Number(timestamp) })

    // HMAC-SHA256 signature: timestamp.body
    const sig = 'sha256=' + createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')

    let httpStatus = 0
    let responseBody = ''
    let delivered = false

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Facilitator-Signature': sig,
          'X-Facilitator-Timestamp': timestamp,
          'X-Facilitator-Event': event,
          'User-Agent': 'facilitatorx402/1.0',
        },
        body,
        signal: controller.signal,
      })

      clearTimeout(timeout)
      httpStatus = response.status
      responseBody = await response.text().catch(() => '')
      delivered = response.ok

      logger.info({ deliveryId, sellerId, event, url, httpStatus, attempt: job.attemptsMade }, 'webhook delivered')
    } catch (err: any) {
      httpStatus = 0
      responseBody = err?.message ?? 'Network error'
      delivered = false
      logger.warn({ deliveryId, sellerId, event, url, err: err?.message, attempt: job.attemptsMade }, 'webhook delivery failed')
    }

    // Persist delivery result
    try {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: delivered ? 'delivered' : 'failed',
          httpStatus,
          responseBody: responseBody.slice(0, 2000), // cap at 2KB
          attempts: job.attemptsMade + 1,
          deliveredAt: delivered ? new Date() : null,
        },
      })
    } catch (dbErr) {
      logger.error({ dbErr, deliveryId }, 'failed to update webhook delivery status')
    }

    // Rethrow on failure so BullMQ retries
    if (!delivered) {
      throw new Error(`Webhook delivery failed: HTTP ${httpStatus} — ${responseBody.slice(0, 200)}`)
    }
  },
  {
    connection: redis,
    concurrency: 10,
    limiter: { max: 50, duration: 1000 }, // 50 webhooks/sec max
  }
)

webhookWorker.on('failed', (job, err) => {
  logger.error({
    jobId: job?.id,
    deliveryId: job?.data?.deliveryId,
    sellerId: job?.data?.sellerId,
    event: job?.data?.event,
    attempts: job?.attemptsMade,
    err: err.message,
  }, 'webhook job exhausted retries')
})

webhookWorker.on('error', (err) => {
  logger.error({ err }, 'webhook worker error')
})
