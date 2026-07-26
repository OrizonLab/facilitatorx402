import crypto from 'node:crypto'
import { ulid } from 'ulid'
import { logger } from './logger.js'

export interface WebhookPayload {
  id: string
  event: string
  createdAt: string
  data: Record<string, unknown>
}

export interface WebhookTarget {
  subscriptionId: string
  url: string
  secret: string
  events: string[]
}

const MAX_RETRIES = 5
const RETRY_DELAYS_MS = [0, 5_000, 30_000, 120_000, 600_000] // 0s, 5s, 30s, 2m, 10m

/**
 * Signs and dispatches a webhook to a target URL.
 * Uses HMAC-SHA256 signature in `X-Facilitator-Signature` header.
 * Autonomous devices (robots, IoT) can verify payloads using the shared secret.
 */
export async function dispatchWebhook(
  target: WebhookTarget,
  event: string,
  data: Record<string, unknown>
): Promise<{ delivered: boolean; httpStatus?: number; error?: string }> {
  if (!target.events.includes(event)) {
    return { delivered: false, error: 'event_not_subscribed' }
  }

  const payload: WebhookPayload = {
    id: `evt_${ulid()}`,
    event,
    createdAt: new Date().toISOString(),
    data,
  }

  const body = JSON.stringify(payload)
  const signature = computeSignature(body, target.secret)

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      await sleep(RETRY_DELAYS_MS[attempt - 1]!)
    }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)

      const response = await fetch(target.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Facilitator-Signature': `sha256=${signature}`,
          'X-Facilitator-Event': event,
          'X-Facilitator-Delivery': payload.id,
          'User-Agent': 'facilitatorx402-webhook/1.1.0',
        },
        body,
        signal: controller.signal,
      })

      clearTimeout(timer)

      if (response.ok) {
        logger.info(
          { subscriptionId: target.subscriptionId, event, attempt, httpStatus: response.status },
          'webhook delivered'
        )
        return { delivered: true, httpStatus: response.status }
      }

      logger.warn(
        { subscriptionId: target.subscriptionId, event, attempt, httpStatus: response.status },
        'webhook delivery failed, will retry'
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn(
        { subscriptionId: target.subscriptionId, event, attempt, error: message },
        'webhook dispatch error'
      )
      if (attempt === MAX_RETRIES) {
        return { delivered: false, error: message }
      }
    }
  }

  return { delivered: false, error: 'max_retries_exceeded' }
}

/**
 * Verifies an incoming webhook signature.
 * Use this in your receiver to validate that the payload came from the facilitator.
 */
export function verifyWebhookSignature(body: string, secret: string, signature: string): boolean {
  const expected = `sha256=${computeSignature(body, secret)}`
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

function computeSignature(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
