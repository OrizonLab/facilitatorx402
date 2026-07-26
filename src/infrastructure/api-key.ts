/**
 * API key generation & verification.
 * Keys are bcrypt-hashed in PostgreSQL (apiKeyHash column).
 * The raw key is shown only once at registration.
 */
import crypto from 'node:crypto'
import { ulid } from 'ulid'

/** Generate a cryptographically random API key */
export function generateApiKey(): { raw: string; hash: string } {
  const raw = `fac_${crypto.randomBytes(32).toString('hex')}`
  // Hash with SHA-256 for storage (bcrypt is safer but slower — switch if needed)
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}

/** Constant-time comparison to prevent timing attacks */
export function verifyApiKey(rawKey: string, storedHash: string): boolean {
  const hash = crypto.createHash('sha256').update(rawKey).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash))
  } catch {
    return false
  }
}

export function generateSellerId(): string {
  return `seller_${ulid()}`
}

export function generateWebhookId(): string {
  return `wh_${ulid()}`
}

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('hex')}`
}
