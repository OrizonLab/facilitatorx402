/**
 * Unit tests — Settle idempotence and duplicate protection
 *
 * Verifies that:
 *   - Calling /settle twice with same requestId returns identical result
 *   - A confirmed settlement is never re-processed
 *   - A failed settlement is reported without re-submission
 *   - Redis lock prevents concurrent duplicates
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies
vi.mock('../../src/infrastructure/db.js', () => ({
  db: {
    paymentVerification: { findFirst: vi.fn() },
    paymentSettlement: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    paymentReceipt: { create: vi.fn() },
    seller: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    network: { findUnique: vi.fn() },
  },
}))

vi.mock('../../src/infrastructure/redis.js', () => ({
  getRedis: vi.fn(),
}))

vi.mock('../../src/settlement/on-chain.js', () => ({
  submitOnChain: vi.fn(),
}))

vi.mock('../../src/settlement/fee-engine.js', () => ({
  computeFees: vi.fn(),
}))

vi.mock('../../src/infrastructure/network-registry.js', () => ({
  networkRegistry: {
    getNetwork: vi.fn(),
  },
}))

import { db } from '../../src/infrastructure/db.js'
import { getRedis } from '../../src/infrastructure/redis.js'
import { runSettle } from '../../src/application/settle.service.js'

const mockRedis = { set: vi.fn(), del: vi.fn() }

const mockVerification = {
  id: 'v1',
  requestId: 'req_1',
  verificationStatus: 'accepted',
  nonce: '0x' + 'cc'.repeat(32),
  signatureHash: 'aabbcc',
  request: {
    id: 'req_1',
    buyerAddress: '0x' + 'aa'.repeat(20),
    amount: '1000000',
    asset: 'USDC',
    invoiceId: 'inv_1',
    expiresAt: new Date(Date.now() + 3600_000),
    sellerId: null,
    network: { id: 'net1', chainId: 8453 },
    receipt: null,
  },
}

const confirmedSettlement = {
  id: 'settle_1',
  settlementStatus: 'confirmed',
  txHash: '0x' + 'ff'.repeat(32),
  feeAmount: '5000',
  developerShare: '10',
  confirmedAt: new Date(),
  createdAt: new Date(),
  request: { receipt: { id: 'receipt_1' } },
}

beforeEach(() => {
  vi.mocked(getRedis).mockReturnValue(mockRedis as any)
  mockRedis.set.mockResolvedValue('OK')
  mockRedis.del.mockResolvedValue(1)
  vi.mocked(db.paymentVerification.findFirst).mockResolvedValue(mockVerification as any)
})

describe('runSettle — idempotence', () => {
  it('returns existing confirmed settlement without re-processing', async () => {
    vi.mocked(db.paymentSettlement.findFirst).mockResolvedValue(confirmedSettlement as any)

    const result = await runSettle({ requestId: 'req_1', verificationId: 'v1' })

    expect(result.status).toBe('confirmed')
    expect((result as any).settlementId).toBe('settle_1')
    expect((result as any).txHash).toBe('0x' + 'ff'.repeat(32))
    // submitOnChain must NOT have been called
    const { submitOnChain } = await import('../../src/settlement/on-chain.js')
    expect(submitOnChain).not.toHaveBeenCalled()
  })

  it('rejects if previous settlement failed', async () => {
    vi.mocked(db.paymentSettlement.findFirst).mockResolvedValue({
      ...confirmedSettlement,
      settlementStatus: 'failed',
      txHash: null,
    } as any)

    const result = await runSettle({ requestId: 'req_1', verificationId: 'v1' })
    expect(result.status).toBe('failed')
    expect((result as any).error.code).toBe('settlement_failed')
  })

  it('rejects with settlement_pending when Redis lock is held', async () => {
    vi.mocked(db.paymentSettlement.findFirst).mockResolvedValue(null)
    mockRedis.set.mockResolvedValue(null) // SETNX failed = lock held

    const result = await runSettle({ requestId: 'req_1', verificationId: 'v1' })
    expect((result as any).error.code).toBe('settlement_pending')
  })

  it('rejects with verification_not_found if verification missing or rejected', async () => {
    vi.mocked(db.paymentVerification.findFirst).mockResolvedValue(null)
    vi.mocked(db.paymentSettlement.findFirst).mockResolvedValue(null)

    const result = await runSettle({ requestId: 'req_1', verificationId: 'v_bad' })
    expect((result as any).error.code).toBe('verification_not_found')
  })
})
