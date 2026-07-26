/**
 * safe-compare.ts — Timing-safe string comparisons.
 *
 * All secret/token comparisons in the codebase MUST go through `safeEqual`.
 * Direct string comparison (`===`) on secrets is vulnerable to timing attacks:
 * an attacker can measure response time differences to brute-force tokens
 * one character at a time.
 *
 * This module uses Node.js `crypto.timingSafeEqual` which runs in constant
 * time regardless of where the strings differ.
 *
 * Usage:
 *   import { safeEqual } from '../infrastructure/safe-compare.js'
 *   if (!safeEqual(providedToken, expectedToken)) return reply.status(401)...
 */
import { timingSafeEqual } from 'node:crypto'

/**
 * Compares two strings in constant time.
 * Returns false immediately if lengths differ (does NOT leak length info
 * beyond what the protocol already reveals).
 *
 * @param a - The value provided by the caller (e.g., from a request header)
 * @param b - The expected value (e.g., from config)
 * @returns true if a === b in constant time, false otherwise
 */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  try {
    const bufA = Buffer.from(a)
    const bufB = Buffer.from(b)
    // Pads shorter buffer to avoid length-based timing differences
    // while preserving the correct boolean result
    if (bufA.length !== bufB.length) {
      // Still run timingSafeEqual to consume constant time, then return false
      timingSafeEqual(Buffer.alloc(bufA.length), Buffer.alloc(bufA.length))
      return false
    }
    return timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}
