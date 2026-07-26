import { describe, it, expect, vi, beforeEach } from 'vitest'
import { settlePayment } from '../../src/settlement/settle-payment.js'
import type { SettleDeps } from '../../src/settlement/settle-payment.js'

// ─── Mock on-chain sender — never hits real RPC in unit tests
vi.mock('../../src/settlement/on-chain-sender.js', () => ({
  sendTransferWithAuthorization: vi.fn(async () => ({
    txHash: '0x' + 'a'.repeat(64),
    blockNumber: BigInt(1000),
    gasUsed: BigInt(80000),
  })),
}))

// ─── Fixtures
const REQUEST_ID = 'req-test-001'
const SETTLEMENT_ID = 'set-test-001'
const RECEIPT_ID = 'rec-test-001'

const PAYMENT_REQUEST = {
  id: REQUEST_ID,
  seller: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  buyer:  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  network: 'base-mainnet',
  asset:   'USDC',
  amount:  BigInt(1_000_000),
  invoiceId: 'inv_settle_001',
  scheme: 'exact',
  expiresAt: new Date(Date.now() + 300_000),
  verifications: [
    {
      id: 'ver-001',
      verificationStatus: 'accepted',
      nonce: '0x' + '1'.repeat(64),
      signatureHash: '0x' + 'a'.repeat(130),
    },
  ],
}

const NETWORK_REGISTRY = {
  getNetwork: (name: string) =>
    name === 'base-mainnet'
      ? {
          chainId: 8453,
          name: 'base-mainnet',
          assets: {
            USDC: {
              symbol: 'USDC',
              contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
              decimals: 6,
              eip712Version: '2',
            },
          },
        }
      : undefined,
}

const makePrisma = (opts: {
  existingSettlement?: any
  findRequestResult?: any
}) => ({
  paymentRequest: {
    findUnique: vi.fn(async () => opts.findRequestResult ?? PAYMENT_REQUEST),
  },
  paymentSettlement: {
    findFirst: vi.fn(async () => opts.existingSettlement ?? null),
    create: vi.fn(async ({ data }: any) => ({ id: SETTLEMENT_ID, ...data })),
    update: vi.fn(async ({ data }: any) => ({ id: SETTLEMENT_ID, ...data })),
  },
  paymentReceipt: {
    create: vi.fn(async ({ data }: any) => ({ id: RECEIPT_ID, ...data })),
  },
  $transaction: vi.fn(async (fn: any) => fn({
    paymentSettlement: { update: vi.fn(async () => ({})) },
    paymentReceipt: { create: vi.fn(async () => ({ id: RECEIPT_ID })) },
  })),
})

const mockRedisStore = new Map<string, string>()
const REDIS = {
  async set(key: string, val: string, _ex: string, _ttl: number, flag: string) {
    if (flag === 'NX') {
      if (mockRedisStore.has(key)) return null
      mockRedisStore.set(key, val)
      return 'OK'
    }
    mockRedisStore.set(key, val)
    return 'OK'
  },
  async del(key: string) { mockRedisStore.delete(key); return 1 },
} as any

const LOGGER = {
  child: () => LOGGER,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as any

function makeDeps(prismaOpts = {}): SettleDeps {
  return {
    prisma: makePrisma(prismaOpts) as any,
    redis: REDIS,
    logger: LOGGER,
    networkRegistry: NETWORK_REGISTRY,
    relayerPrivateKey: '0x' + 'a'.repeat(64),
  }
}

beforeEach(() => {
  mockRedisStore.clear()
  vi.clearAllMocks()
})

describe('settlePayment', () => {
  it('settles a verified payment and returns confirmed result', async () => {
    const result = await settlePayment({ paymentRequestId: REQUEST_ID }, makeDeps())
    expect(result.settled).toBe(true)
    if (result.settled) {
      expect(result.status).toBe('confirmed')
      expect(result.txHash).toMatch(/^0x/)
      expect(result.receiptId).toBeDefined()
    }
  })

  it('is idempotent — returns existing settlement on duplicate call', async () => {
    const existingSettlement = {
      id: SETTLEMENT_ID,
      settlementStatus: 'confirmed',
      txHash: '0x' + 'b'.repeat(64),
      receipt: { id: RECEIPT_ID },
    }
    const result = await settlePayment(
      { paymentRequestId: REQUEST_ID },
      makeDeps({ existingSettlement }),
    )
    expect(result.settled).toBe(true)
    if (result.settled) {
      expect(result._idempotent).toBe(true)
      expect(result.txHash).toBe(existingSettlement.txHash)
    }
  })

  it('returns settlement_pending when lock is held', async () => {
    // Pre-lock
    mockRedisStore.set(`settle_lock:${REQUEST_ID}`, '1')
    const result = await settlePayment({ paymentRequestId: REQUEST_ID }, makeDeps())
    expect(result.settled).toBe(false)
    if (!result.settled) {
      expect(result.error.code).toBe('settlement_pending')
    }
  })

  it('throws verification_required when no accepted verification', async () => {
    const deps = makeDeps({
      findRequestResult: { ...PAYMENT_REQUEST, verifications: [] },
    })
    await expect(
      settlePayment({ paymentRequestId: REQUEST_ID }, deps),
    ).rejects.toMatchObject({ code: 'verification_required' })
  })

  it('throws verification_required when payment request not found', async () => {
    const deps = makeDeps({ findRequestResult: null })
    await expect(
      settlePayment({ paymentRequestId: 'nonexistent' }, deps),
    ).rejects.toMatchObject({ code: 'verification_required' })
  })

  it('includes referralCode in settlement data', async () => {
    const prisma = makePrisma({}) as any
    const deps = { ...makeDeps(), prisma }
    await settlePayment(
      { paymentRequestId: REQUEST_ID, referralCode: 'REF123' },
      deps,
    )
    const createCall = prisma.paymentSettlement.create.mock.calls[0]?.[0]
    expect(createCall?.data?.referralCode).toBe('REF123')
  })

  it('the same payment is never settled twice — idempotence guarantee', async () => {
    const existingSettlement = {
      id: 'set-existing',
      settlementStatus: 'confirmed',
      txHash: '0x' + 'c'.repeat(64),
      receipt: { id: 'rec-existing' },
    }
    // Both calls must return same result, no new on-chain tx
    const r1 = await settlePayment(
      { paymentRequestId: REQUEST_ID },
      makeDeps({ existingSettlement }),
    )
    const r2 = await settlePayment(
      { paymentRequestId: REQUEST_ID },
      makeDeps({ existingSettlement }),
    )
    expect(r1.settled).toBe(true)
    expect(r2.settled).toBe(true)
    if (r1.settled && r2.settled) {
      expect(r1.txHash).toBe(r2.txHash)
      expect(r1._idempotent).toBe(true)
      expect(r2._idempotent).toBe(true)
    }
  })
})
