import { describe, it, expect } from 'vitest'
import { calculateFees } from '../../src/settlement/fee-calculator.js'

const CONFIG = { platformFeeBps: 50, developerSharePercent: 20 }

describe('calculateFees', () => {
  it('computes correct fee for 1 USDC (1_000_000 units, 50 bps)', () => {
    const result = calculateFees(BigInt(1_000_000), CONFIG, false)
    expect(result.feeAmount).toBe(BigInt(5_000))
    expect(result.developerShare).toBe(BigInt(0))
    expect(result.netAmount).toBe(BigInt(995_000))
  })

  it('computes developer share with referral code', () => {
    const result = calculateFees(BigInt(1_000_000), CONFIG, true)
    expect(result.feeAmount).toBe(BigInt(5_000))
    expect(result.developerShare).toBe(BigInt(1_000))  // 20% of 5_000
    expect(result.netAmount).toBe(BigInt(995_000))
  })

  it('uses floor rounding — no fractional units', () => {
    // 1 unit × 50bps = 0.005 → floor = 0
    const result = calculateFees(BigInt(1), CONFIG, false)
    expect(result.feeAmount).toBe(BigInt(0))
  })

  it('handles zero amount', () => {
    const result = calculateFees(BigInt(0), CONFIG, true)
    expect(result.feeAmount).toBe(BigInt(0))
    expect(result.developerShare).toBe(BigInt(0))
    expect(result.netAmount).toBe(BigInt(0))
  })

  it('handles large amounts (100 USDC)', () => {
    const result = calculateFees(BigInt(100_000_000), CONFIG, true)
    expect(result.feeAmount).toBe(BigInt(500_000))
    expect(result.developerShare).toBe(BigInt(100_000))
    expect(result.netAmount).toBe(BigInt(99_500_000))
  })
})
