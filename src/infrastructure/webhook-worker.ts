/**
 * Webhook worker V2 — BullMQ worker for HTTP delivery of seller events.
 *
 * For each job:
 *   1. Sign payload with HMAC-SHA256 (webhookSecret)
 *   2. POST to webhookUrl with X-Webhook-Signature + X-Webhook-Event headers
 *   3. Accept 2xx as success; any other status = retry
 *   4. After 5 failed attempts → job moves to failed queue (dead-letter)
 *
 * Signature format:
 *   X-Webhook-Signature: sha256=<HMAC-SHA256(webhookSecret, JSON.stringify(payload))>
 *
 * The seller should verify this signature before processing the event.
 */
import { Worker, type Job } from 'bullmq'
import crypto from 'node:crypto'
import { getRedis } from './redis.js'
import { metrics } from './metrics.js'
import { logger } from './logger.js'
import type { WebhookJob } from './webhook-queue.js'

const WEBHOOK_TIMEOUT_MS = 10_000

function signPayload(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
}

async function deliverWebhook(job: Job<WebhookJob>): Promise<void> {
  const { webhookUrl, webhookSecret, payload } = job.data
  const body = JSON.stringify(payload)
  const signature = signPayload(webhookSecret, body)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': payload.event,
        'X-Facilitator-Version': 'x402-v2',
      },
      body,
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Webhook delivery failed: HTTP ${response.status} from ${webhookUrl}`)
    }

    logger.info(
      { event: payload.event, requestId: payload.requestId, webhookUrl, status: response.status },
      'webhook delivered'
    )
  } finally {
    clearTimeout(timeout)
  }
}

export function startWebhookWorker(): Worker {
  const worker = new Worker<WebhookJob>(
    'webhooks',
    deliverWebhook,
    {
      connection: getRedis(),
      concurrency: 10,
    }
  )

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, event: job.data.payload.event }, 'webhook job completed')
  })

  worker.on('failed', (job, err) => {
    const attempts = job?.attemptsMade ?? 0
    logger.error(
      { jobId: job?.id, event: job?.data?.payload?.event, attempts, err },
      'webhook job failed'
    )
    if (attempts >= 5) {
      logger.error({ jobId: job?.id }, 'webhook dead-lettered after max retries')
    }
  })

  logger.info('webhook worker started')
  return worker
}
