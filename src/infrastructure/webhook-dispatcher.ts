/**
 * Webhook dispatcher — delivers signed HTTP POST to subscriber URL.
 *
 * Signature: HMAC-SHA256 of the JSON payload, using the webhook secret.
 * Consumers verify: X-Facilitator-Signature header.
 *
 * Timeout: 10s per delivery attempt.
 */
import crypto from 'node:crypto'

export interface WebhookSubscription {
  subscriptionId: string
  url: string
  secret: string
  events: string[]
}

export interface DispatchResult {
  delivered: boolean
  httpStatus?: number
  error?: string
}

export async function dispatchWebhook(
  subscription: WebhookSubscription,
  event: string,
  payload: Record<string, unknown>
): Promise<DispatchResult> {
  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  })

  const signature = crypto
    .createHmac('sha256', subscription.secret)
    .update(body)
    .digest('hex')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Facilitator-Event': event,
        'X-Facilitator-Signature': `sha256=${signature}`,
        'X-Facilitator-Subscription-Id': subscription.subscriptionId,
        'User-Agent': 'facilitatorx402/1.0',
      },
      body,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.ok) {
      return { delivered: true, httpStatus: response.status }
    }

    const responseText = await response.text().catch(() => '')
    return {
      delivered: false,
      httpStatus: response.status,
      error: `HTTP ${response.status}: ${responseText.slice(0, 200)}`,
    }
  } catch (err: any) {
    clearTimeout(timeout)
    return {
      delivered: false,
      error: err?.name === 'AbortError' ? 'timeout after 10s' : err?.message,
    }
  }
}
