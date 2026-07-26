import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifyPayment } from '../../src/application/verify-payment.js'
import type { VerifyDeps } from '../../src/application/verify-payment.js'

// ─── Mocks ───────────────────────────────────────────────────────────────────

const VALID_BODY = {
  version: '1',
  scheme: 'exact',
  network: 'base-mainnet',
  asset: 'USDC',
  invoiceId: 'inv_unit_001',
  requiredAmount: '1000000',
  recipient: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  payload: {
    signature: '0x' + 'a'.repeat(130),
    authorization: {
      from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      to:   '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      value: '1000000',
      validAfter:  0,
      validBefore: Math.floor(Date.now() / 1000) + 300,
      nonce: '0x' + '1'.repeat(64),
    },
  },
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

const mockRedisStore = new Map<string, string>()
const REDIS = {
  store: mockRedisStore,
  async set(key: string, val: string, _ex: string, _ttl: number, flag: string) {
    if (flag === 'NX') {
      if (this.store.has(key)) return null
      this.store.set(key, val)
      return 'OK'
    }
    this.store.set(key, val)
    return 'OK'
  },
  async get(key: string) { return this.store.get(key) ?? null },
  async del(key: string) { this.store.delete(key); return 1 },
} as any

const PRISMA = {
  $transaction: vi.fn(async (fn: any) => {
    const pr = { id: 'req-mock-id' }
    const v = { id: 'ver-mock-id' }
    await fn({
      paymentRequest: { create: vi.fn(async () => pr) },
      paymentVerification: { create: vi.fn(async () => v) },
    })
    return [pr, v]
  }),
} as any

const LOGGER = {
  child: () => LOGGER,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as any

const DEPS: VerifyDeps = {
  prisma: PRISMA,
  redis: REDIS,
  logger: LOGGER,
  networkRegistry: NETWORK_REGISTRY,
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockRedisStore.clear()
  vi.clearAllMocks()
})

// Patch signature verifier to avoid real crypto
vi.mock('../../src/crypto/signature-verifier.js', () => ({
  verifyErc3009Signature: vi.fn(async ({ authorization }: any) => authorization.from),
  computeSignatureHash: (sig: string) => sig.toLowerCase(),
}))

describe('verifyPayment', () => {
  it('returns accepted result for valid proof', async () => {
    const result = await verifyPayment(VALID_BODY, DEPS)
    expect(result.status).toBe('accepted')
    expect(result.network).toBe('base-mainnet')
    expect(result.asset).toBe('USDC')
    expect(result.from).toBe(VALID_BODY.payload.authorization.from)
  })

  it('throws invalid_payload on malformed body', async () => {
    await expect(verifyPayment({ version: '1' }, DEPS)).rejects.toMatchObject({
      code: 'invalid_payload',
    })
  })

  it('throws unsupported_network for unknown network', async () => {
    await expect(
      verifyPayment({ ...VALID_BODY, network: 'ethereum-mainnet' }, DEPS),
    ).rejects.toMatchObject({ code: 'unsupported_network' })
  })

  it('throws unsupported_asset for unknown asset', async () => {
    await expect(
      verifyPayment({ ...VALID_BODY, asset: 'WETH' }, DEPS),
    ).rejects.toMatchObject({ code: 'unsupported_asset' })
  })

  it('throws expired_payment when validBefore is in the past', async () => {
    const body = {
      ...VALID_BODY,
      payload: {
        ...VALID_BODY.payload,
        authorization: { ...VALID_BODY.payload.authorization, validBefore: 1 },
      },
    }
    await expect(verifyPayment(body, DEPS)).rejects.toMatchObject({ code: 'expired_payment' })
  })

  it('throws invalid_payload on recipient mismatch', async () => {
    const body = { ...VALID_BODY, recipient: '0x' + '9'.repeat(40) }
    await expect(verifyPayment(body, DEPS)).rejects.toMatchObject({ code: 'invalid_payload' })
  })

  it('throws invalid_payload when amount too low', async () => {
    const body = { ...VALID_BODY, requiredAmount: '9999999999' }
    await expect(verifyPayment(body, DEPS)).rejects.toMatchObject({ code: 'invalid_payload' })
  })

  it('throws duplicate_payment on nonce replay', async () => {
    await verifyPayment(VALID_BODY, DEPS)
    // Second call — same nonce, different invoice
    await expect(
      verifyPayment({ ...VALID_BODY, invoiceId: 'inv_replay' }, DEPS),
    ).rejects.toMatchObject({ code: 'duplicate_payment' })
  })

  it('persists verificationId and paymentRequestId', async () => {
    const result = await verifyPayment(VALID_BODY, DEPS)
    expect(result.verificationId).toBeDefined()
    expect(result.paymentRequestId).toBeDefined()
  })
})
