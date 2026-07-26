/**
 * Anti-replay protection.
 *
 * Two complementary layers:
 *   1. Redis SET NX (fast, in-memory check)
 *   2. PostgreSQL UNIQUE constraint on signature_hash + nonce (durable)
 *
 * The Redis key expires after 48h (payment window).
 * PostgreSQL is the authoritative source of truth.
 *
 * Nonce: bytes32 from the EIP-3009 authorization
 * Signature hash: SHA-256 of the raw signature bytes
 */
import crypto from 'node:crypto'
import { getRedis } from '../infrastructure/redis.js'
import { db } from '../infrastructure/db.js'

const NONCE_TTL_SECONDS = 48 * 60 * 60 // 48h

export function hashSignature(signature: string): string {
  return crypto.createHash('sha256').update(signature).digest('hex')
}

export interface ReplayCheckResult {
  isDuplicate: boolean
  reason?: 'nonce_used' | 'signature_used'
}

/**
 * Check Redis for a used nonce or signature hash.
 * Fast path — avoids PostgreSQL on the hot path.
 */
export async function checkReplayRedis(
  nonce: string,
  signatureHash: string
): Promise<ReplayCheckResult> {
  const redis = getRedis()
  const [nonceExists, sigExists] = await Promise.all([
    redis.exists(`nonce:${nonce}`),
    redis.exists(`sig:${signatureHash}`),
  ])

  if (nonceExists) return { isDuplicate: true, reason: 'nonce_used' }
  if (sigExists) return { isDuplicate: true, reason: 'signature_used' }
  return { isDuplicate: false }
}

/**
 * Check PostgreSQL for a used nonce or signature hash.
 * Fallback if Redis is empty (e.g., after a Redis flush).
 */
export async function checkReplayPostgres(
  nonce: string,
  signatureHash: string
): Promise<ReplayCheckResult> {
  const existing = await db.paymentVerification.findFirst({
    where: {
      OR: [
        { nonce },
        { signatureHash },
      ],
    },
    select: { id: true, nonce: true, signatureHash: true },
  })

  if (!existing) return { isDuplicate: false }
  if (existing.nonce === nonce) return { isDuplicate: true, reason: 'nonce_used' }
  return { isDuplicate: true, reason: 'signature_used' }
}

/**
 * Mark a nonce and signature hash as used in Redis.
 * Called only after a successful verification is persisted to PostgreSQL.
 */
export async function markReplayUsed(
  nonce: string,
  signatureHash: string
): Promise<void> {
  const redis = getRedis()
  await Promise.all([
    redis.setex(`nonce:${nonce}`, NONCE_TTL_SECONDS, '1'),
    redis.setex(`sig:${signatureHash}`, NONCE_TTL_SECONDS, '1'),
  ])
}
