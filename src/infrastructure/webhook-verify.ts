/**
 * Webhook signature verification — for sellers validating incoming events.
 *
 * Usage (seller side):
 *   import { verifyWebhookSignature } from '@orizonlab/x402-client'
 *   const valid = verifyWebhookSignature(rawBody, webhookSecret, req.headers['x-webhook-signature'])
 *
 * Also exported from the facilitator for testing and documentation.
 */
import crypto from 'node:crypto'

/**
 * Verifies the HMAC-SHA256 signature of a webhook payload.
 * @param rawBody - The raw JSON string body of the POST request
 * @param secret  - The seller’s webhook secret (from seller config)
 * @param header  - The X-Webhook-Signature header value
 * @returns true if signature is valid
 */
export function verifyWebhookSignature(
  rawBody: string,
  secret: string,
  header: string | undefined
): boolean {
  if (!header) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header))
}
