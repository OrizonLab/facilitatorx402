/**
 * Standalone webhook signature verifier — no dependencies.
 * Re-exported from main SDK index.
 */
import crypto from 'crypto'

export function verifyWebhookSignature(
  rawBody: string,
  secret: string,
  header: string | undefined
): boolean {
  if (!header || !secret) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header))
  } catch {
    return false
  }
}
