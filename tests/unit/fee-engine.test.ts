/**
 * Unit tests — Fee engine
 * Pure function tests, no DB or Redis required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/infrastructure/config.js', () => ({
  getConfig: () => ({
    PLATFORM_FEE_BPS: 50,
    DEVELOPER_SHARE_BPS: 20,
  }),
}))

import { computeFees } from '../../src/settlement/fee-engine.js'

describe('computeFees', () => {
  it('computes correct platform fee at 50 BPS on 1 USDC', () => {
    const result = computeFees(BigInt(1_000_000))
    expect(result.platformFee).toBe(BigInt(5_000))
    expect(result.netAmount).toBe(BigInt(995_000))
  })

  it('computes developer share at 20 BPS of platform fee', () => {
    const result = computeFees(BigInt(1_000_000))
    // 5_000 * 20 / 10_000 = 10
    expect(result.developerShare).toBe(BigInt(10))
  })

  it('grossAmount === netAmount + platformFee', () => {
    const result = computeFees(BigInt(5_000_000))
    expect(result.netAmount + result.platformFee).toBe(result.grossAmount)
  })

  it('uses override feeBps when provided', () => {
    const result = computeFees(BigInt(1_000_000), 100) // 1%
    expect(result.platformFee).toBe(BigInt(10_000))
    expect(result.feeBps).toBe(100)
  })

  it('returns zero fees for zero amount', () => {
    const result = computeFees(BigInt(0))
    expect(result.platformFee).toBe(BigInt(0))
    expect(result.developerShare).toBe(BigInt(0))
  })

  it('uses integer arithmetic — no floating point error', () => {
    // 1 unit at 50 BPS = 0 (rounds down, integer)
    const result = computeFees(BigInt(1))
    expect(result.platformFee).toBe(BigInt(0))
    expect(result.netAmount).toBe(BigInt(1))
  })

  it('exposes feeBps and developerShareBps in result', () => {
    const result = computeFees(BigInt(1_000_000))
    expect(result.feeBps).toBe(50)
    expect(result.developerShareBps).toBe(20)
  })
})
