import crypto from 'node:crypto'
import { ulid } from 'ulid'

const API_KEY_PREFIX = 'fx402_live_'

/**
 * Generates a secure API key for a seller.
 * Format: fx402_live_<32 random hex chars>
 *
 * The raw key is returned once at registration time.
 * Only the SHA-256 hash is stored in the database.
 */
export function generateApiKey(): { raw: string; hash: string } {
  const random = crypto.randomBytes(32).toString('hex')
  const raw = `${API_KEY_PREFIX}${random}`
  const hash = hashApiKey(raw)
  return { raw, hash }
}

/**
 * Hashes an API key for safe storage.
 * Uses SHA-256 (fast lookup, collision-resistant for this use case).
 */
export function hashApiKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/**
 * Verifies an API key against its stored hash.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyApiKey(raw: string, storedHash: string): boolean {
  const candidateHash = hashApiKey(raw)
  try {
    return crypto.timingSafeEqual(
      Buffer.from(candidateHash, 'hex'),
      Buffer.from(storedHash, 'hex')
    )
  } catch {
    return false
  }
}

/**
 * Generates a signing secret for webhook subscriptions.
 * Format: whsec_<40 random hex chars>
 */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(40).toString('hex')}`
}

export function generateSellerId(): string {
  return `sel_${ulid()}`
}

export function generateWebhookId(): string {
  return `wh_${ulid()}`
}
