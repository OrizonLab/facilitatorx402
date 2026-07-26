import { describe, it, expect } from 'vitest'
import { FeeEngine, createFeeEngine } from '../../src/settlement/fee-engine.js'

const SELLER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

function engine(overrides: Partial<Parameters<typeof createFeeEngine>[0]> = {}) {
  return createFeeEngine({
    platformFeeBps:       50,
    developerShareBps:    2000,
    freeTierMonthlyUnits: 0n,
    ...overrides,
  })
}

describe('FeeEngine.compute', () => {
  it('computes standard 50bps fee without referral', () => {
    const b = engine().compute(1_000_000n, SELLER, null)
    expect(b.platformFee).toBe(5_000n)      // 0.5% of 1 USDC
    expect(b.developerShare).toBe(0n)        // no referral
    expect(b.netToSeller).toBe(995_000n)
    expect(b.effectiveFeeBps).toBe(50)
    expect(b.freeTierApplied).toBe(false)
  })

  it('computes developer share (20%) when referralCode provided', () => {
    const b = engine().compute(1_000_000n, SELLER, 'PARTNER_XYZ')
    expect(b.platformFee).toBe(5_000n)
    expect(b.developerShare).toBe(1_000n)   // 20% of 5_000
    expect(b.referralCode).toBe('PARTNER_XYZ')
  })

  it('applies free tier — zero fee when monthly volume below threshold', () => {
    const e = engine({ freeTierMonthlyUnits: 100_000_000n })  // 100 USDC
    const b = e.compute(1_000_000n, SELLER, null, 0n)          // first settlement
    expect(b.platformFee).toBe(0n)
    expect(b.freeTierApplied).toBe(true)
    expect(b.netToSeller).toBe(1_000_000n)
  })

  it('charges fee once monthly volume exceeds free tier', () => {
    const e = engine({ freeTierMonthlyUnits: 100_000_000n })
    const b = e.compute(1_000_000n, SELLER, null, 100_000_000n)  // exactly at threshold
    expect(b.freeTierApplied).toBe(false)
    expect(b.platformFee).toBe(5_000n)
  })

  it('applies premium tier override for specific seller', () => {
    const e = engine({
      premiumTiers: [{ sellerAddress: SELLER, feeBps: 10 }],  // 0.1% instead of 0.5%
    })
    const b = e.compute(1_000_000n, SELLER, null)
    expect(b.effectiveFeeBps).toBe(10)
    expect(b.platformFee).toBe(1_000n)
  })

  it('ignores expired premium tier', () => {
    const past = new Date(Date.now() - 1000)
    const e = engine({
      premiumTiers: [{ sellerAddress: SELLER, feeBps: 10, expiresAt: past }],
    })
    const b = e.compute(1_000_000n, SELLER, null)
    expect(b.effectiveFeeBps).toBe(50)  // fallback to standard
  })

  it('zero fee on zero amount', () => {
    const b = engine().compute(0n, SELLER, null)
    expect(b.platformFee).toBe(0n)
    expect(b.netToSeller).toBe(0n)
  })

  it('handles large amounts without overflow', () => {
    const large = 1_000_000_000_000n  // 1M USDC
    const b = engine().compute(large, SELLER, 'REF')
    expect(b.platformFee).toBe(5_000_000_000n)   // 0.5%
    expect(b.developerShare).toBe(1_000_000_000n) // 20% of fee
    expect(b.netToSeller + b.platformFee).toBe(large)
  })

  it('format() returns serializable plain object', () => {
    const e = engine()
    const b = e.compute(1_000_000n, SELLER, 'CODE')
    const f = e.format(b)
    expect(typeof f.platformFee).toBe('string')
    expect(typeof f.effectiveFeeBps).toBe('number')
    expect(f.referralCode).toBe('CODE')
  })
})
