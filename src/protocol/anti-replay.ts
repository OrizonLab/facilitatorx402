/**
 * Anti-replay protection.
 *
 * Two complementary layers:
 *   1. Redis SET NX (atomic claim — fast, in-memory, race-condition-safe)
 *   2. PostgreSQL UNIQUE constraint on signature_hash + nonce (durable fallback)
 *
 * RACE CONDITION FIX:
 *   The nonce is now atomically claimed in Redis (SET NX EX) BEFORE signature
 *   verification, not after persistence. This closes the window where two
 *   concurrent requests with the same nonce could both pass the check before
 *   either one marked it used.
 *
 *   Flow:
 *     1. claimNonceRedis()  → atomic SET NX — only one caller wins
 *     2. verify signature
 *     3. persist to PostgreSQL
 *     4. if step 2 or 3 fails — releaseNonceRedis() to allow retry
 *
 *   PostgreSQL remains the authoritative durable source of truth.
 *
 * Nonce: bytes32 from the EIP-3009 authorization
 * Signature hash: SHA-256 of the raw signature bytes
 * TTL: 48h — matches the maximum valid payment window
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
 * Does NOT claim — use claimNonceRedis() for the atomic lock.
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
 * Atomically claim a nonce in Redis using SET NX EX.
 *
 * This is the race-condition fix: only one concurrent caller can claim a
 * given nonce. The second caller gets isDuplicate: true immediately.
 *
 * MUST be called before signature verification.
 * If verification or persistence fails, call releaseNonceRedis() to undo.
 *
 * @returns isDuplicate: true if already claimed (replay detected)
 */
export async function claimNonceRedis(
  nonce: string,
  signatureHash: string
): Promise<ReplayCheckResult> {
  const redis = getRedis()

  // Atomic claim: SET NX returns null if key already exists
  const [nonceClaimed, sigClaimed] = await Promise.all([
    redis.set(`nonce:${nonce}`, '1', 'EX', NONCE_TTL_SECONDS, 'NX'),
    redis.set(`sig:${signatureHash}`, '1', 'EX', NONCE_TTL_SECONDS, 'NX'),
  ])

  if (nonceClaimed === null) return { isDuplicate: true, reason: 'nonce_used' }
  if (sigClaimed === null) {
    // Sig already used — release the nonce we just claimed
    await redis.del(`nonce:${nonce}`)
    return { isDuplicate: true, reason: 'signature_used' }
  }

  return { isDuplicate: false }
}

/**
 * Release a previously claimed nonce+sig from Redis.
 * Called when verification or persistence fails after claimNonceRedis().
 * This allows a legitimate retry after a transient error.
 */
export async function releaseNonceRedis(
  nonce: string,
  signatureHash: string
): Promise<void> {
  const redis = getRedis()
  await Promise.all([
    redis.del(`nonce:${nonce}`),
    redis.del(`sig:${signatureHash}`),
  ])
}

/**
 * Check PostgreSQL for a used nonce or signature hash.
 * Durable fallback if Redis is empty (e.g., after a Redis flush or restart).
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
 * @deprecated Prefer claimNonceRedis() for new code (atomic, race-safe).
 * Kept for backward compat with any direct callers.
 */
export async function markReplayUsed(
  nonce: string,
  signatureHash: string
): Promise<void> {
  const redis = getRedis()
  await Promise.all([
    redis.set(`nonce:${nonce}`, '1', 'EX', NONCE_TTL_SECONDS, 'NX'),
    redis.set(`sig:${signatureHash}`, '1', 'EX', NONCE_TTL_SECONDS, 'NX'),
  ])
}
