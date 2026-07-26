/**
 * Integration tests — POST /settle
 *
 * Uses Fastify inject (no real HTTP server) with mocked DB, Redis, and on-chain.
 * Verifies:
 *   - Confirmed settlement returns 200 + correct shape
 *   - Idempotent: second call returns same result without re-submission
 *   - Missing verification returns 402
 *   - Redis lock held returns 409
 *   - On-chain failure returns 502 + settlement_failed
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerSettleRoute } from '../../src/http/routes/settle.route.js'

// ─── Mocks ──────────────────────────────────────────────────────────────────
vi.mock('../../src/infrastructure/db.js', () => ({
  db: {
    paymentVerification: { findFirst: vi.fn() },
    paymentSettlement:   { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    paymentReceipt:      { create: vi.fn() },
    seller:              { findUnique: vi.fn() },
    $transaction:        vi.fn((fn: Function) => fn({
      paymentSettlement: { update: vi.fn() },
      paymentReceipt:    { create: vi.fn() },
    })),
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
  computeFees: vi.fn(() => ({
    grossAmount:    BigInt(1_000_000),
    platformFee:    BigInt(5_000),
    developerShare: BigInt(10),
    netAmount:      BigInt(995_000),
    feeBps:         50,
    developerShareBps: 20,
  })),
}))

vi.mock('../../src/infrastructure/network-registry.js', () => ({
  networkRegistry: {
    getNetwork: vi.fn(() => ({
      chainId:        8453,
      name:           'base',
      rpcUrl:         'https://mainnet.base.org',
      fallbackRpcUrl: null,
      assets: [{ symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }],
    })),
  },
}))

vi.mock('../../src/infrastructure/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }), error: vi.fn() },
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────
import { db }           from '../../src/infrastructure/db.js'
import { getRedis }     from '../../src/infrastructure/redis.js'
import { submitOnChain } from '../../src/settlement/on-chain.js'

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
    expiresAt: new Date(Date.now() + 3_600_000),
    sellerId: null,
    network: { id: 'net1', chainId: 8453 },
    receipt: null,
  },
}

const FAKE_TX = '0x' + 'ab'.repeat(32)

// ─── App setup ───────────────────────────────────────────────────────────────
let app: ReturnType<typeof Fastify>

beforeAll(async () => {
  app = Fastify()
  await registerSettleRoute(app)
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRedis).mockReturnValue(mockRedis as any)
  mockRedis.set.mockResolvedValue('OK')    // lock acquired
  mockRedis.del.mockResolvedValue(1)
  vi.mocked(db.paymentVerification.findFirst).mockResolvedValue(mockVerification as any)
  vi.mocked(db.paymentSettlement.findFirst).mockResolvedValue(null)
  vi.mocked(db.paymentSettlement.create).mockResolvedValue({ id: 'settle_1' } as any)
  vi.mocked(db.paymentSettlement.update).mockResolvedValue({} as any)
  vi.mocked(submitOnChain).mockResolvedValue({
    txHash: FAKE_TX as `0x${string}`,
    blockNumber: BigInt(12345),
    gasUsed: BigInt(100000),
  })
})

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('POST /settle', () => {
  it('200 — confirmed settlement with correct shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: 'req_1', verificationId: 'v1' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('confirmed')
    expect(body.txHash).toBe(FAKE_TX)
    expect(body.feeAmount).toBe('5000')
    expect(body.developerShare).toBe('10')
    expect(body.settlementId).toBeDefined()
    expect(body.receiptId).toBeDefined()
    expect(body.settledAt).toBeDefined()
  })

  it('200 — idempotent: second call returns existing confirmed settlement', async () => {
    vi.mocked(db.paymentSettlement.findFirst).mockResolvedValue({
      id: 'settle_1',
      settlementStatus: 'confirmed',
      txHash: FAKE_TX,
      feeAmount: '5000',
      developerShare: '10',
      confirmedAt: new Date(),
      createdAt: new Date(),
      request: { receipt: { id: 'receipt_1' } },
    } as any)

    const res = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: 'req_1', verificationId: 'v1' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('confirmed')
    expect(body.settlementId).toBe('settle_1')
    // submitOnChain must NOT have been called
    expect(submitOnChain).not.toHaveBeenCalled()
  })

  it('402 — verification not found', async () => {
    vi.mocked(db.paymentVerification.findFirst).mockResolvedValue(null)

    const res = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: 'req_x', verificationId: 'v_bad' },
    })

    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe('verification_not_found')
  })

  it('409 — settlement_pending when Redis lock is held', async () => {
    mockRedis.set.mockResolvedValue(null) // SETNX failed

    const res = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: 'req_1', verificationId: 'v1' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('settlement_pending')
  })

  it('502 — settlement_failed when on-chain throws', async () => {
    vi.mocked(submitOnChain).mockRejectedValue(new Error('transaction reverted'))

    const res = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: 'req_1', verificationId: 'v1' },
    })

    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe('settlement_failed')
    expect(res.json().error.message).toContain('transaction reverted')
  })

  it('400 — invalid payload (missing verificationId)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: 'req_1' }, // missing verificationId
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('invalid_payload')
  })
})
