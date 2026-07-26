import type { Redis } from 'ioredis'

const NONCE_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days — beyond any realistic validBefore window
const NONCE_PREFIX = 'nonce:'
const SIG_PREFIX = 'sig:'

/**
 * Check and claim a nonce in Redis atomically.
 * Returns true if the nonce was freshly claimed (not a replay).
 * Returns false if already seen.
 */
export async function claimNonce(redis: Redis, nonce: string): Promise<boolean> {
  const key = `${NONCE_PREFIX}${nonce.toLowerCase()}`
  // SET key value NX EX ttl — returns 'OK' if set, null if already exists
  const result = await redis.set(key, '1', 'EX', NONCE_TTL_SECONDS, 'NX')
  return result === 'OK'
}

/**
 * Check and claim a signature hash in Redis atomically.
 * Returns true if freshly claimed, false if replay.
 */
export async function claimSignatureHash(redis: Redis, signatureHash: string): Promise<boolean> {
  const key = `${SIG_PREFIX}${signatureHash.toLowerCase()}`
  const result = await redis.set(key, '1', 'EX', NONCE_TTL_SECONDS, 'NX')
  return result === 'OK'
}

/**
 * Check if a nonce is already known (read-only, no claim).
 */
export async function isNonceSeen(redis: Redis, nonce: string): Promise<boolean> {
  const key = `${NONCE_PREFIX}${nonce.toLowerCase()}`
  const val = await redis.get(key)
  return val !== null
}

/**
 * Release a nonce (used on rollback after a failed verification persist).
 */
export async function releaseNonce(redis: Redis, nonce: string): Promise<void> {
  const key = `${NONCE_PREFIX}${nonce.toLowerCase()}`
  await redis.del(key)
}

/**
 * Release a signature hash (used on rollback).
 */
export async function releaseSignatureHash(redis: Redis, signatureHash: string): Promise<void> {
  const key = `${SIG_PREFIX}${signatureHash.toLowerCase()}`
  await redis.del(key)
}
