import { describe, it, expect } from 'vitest'
import { calculateFee } from '../../settlement/fee-calculator.js'

describe('calculateFee', () => {
  it('should calculate 0.5% fee correctly (50 bps)', () => {
    const amount = 1_000_000n // 1 USDC
    const result = calculateFee(amount)
    expect(result.feeAmount).toBe(5_000n) // 0.5%
    expect(result.netAmount).toBe(995_000n)
    expect(result.developerShare).toBe(0n) // no referral
  })

  it('should calculate developer share with referral code (20% of fee)', () => {
    const amount = 1_000_000n
    const result = calculateFee(amount, 'partner_xyz')
    expect(result.feeAmount).toBe(5_000n)
    expect(result.developerShare).toBe(1_000n) // 20% of 5000
    expect(result.netAmount).toBe(995_000n)
  })

  it('should return zero developer share without referral code', () => {
    const result = calculateFee(100_000n, undefined)
    expect(result.developerShare).toBe(0n)
  })

  it('should handle zero fee correctly', () => {
    // 1 unit → 50/10000 = 0 (integer division)
    const result = calculateFee(1n)
    expect(result.feeAmount).toBe(0n)
    expect(result.developerShare).toBe(0n)
    expect(result.netAmount).toBe(1n)
  })

  it('should handle large amounts', () => {
    const amount = 1_000_000_000_000n // 1M USDC
    const result = calculateFee(amount)
    expect(result.feeAmount).toBe(5_000_000_000n) // 0.5%
    expect(result.netAmount).toBe(995_000_000_000n)
  })
})
