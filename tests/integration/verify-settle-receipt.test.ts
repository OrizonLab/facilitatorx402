/**
 * Integration test — full verify → settle → receipt flow.
 *
 * Uses real Prisma + real Redis (via docker-compose.dev.yml).
 * Requires DATABASE_URL and REDIS_URL env vars.
 *
 * Run with: docker compose -f docker-compose.dev.yml up -d
 *           pnpm test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import pino from 'pino'
import { verifyPayment } from '../../src/application/verify-payment.js'
import { settlePayment } from '../../src/settlement/settle-payment.js'
import { getReceiptById } from '../../src/infrastructure/receipt-service.js'

// ─── Skip unless integration env is present
const SKIP = !process.env.DATABASE_URL || !process.env.REDIS_URL

const prisma = new PrismaClient()
const redis  = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
const logger = pino({ level: 'silent' })

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

const VALID_BODY = (suffix: string) => ({
  version: '1',
  scheme: 'exact',
  network: 'base-mainnet',
  asset: 'USDC',
  invoiceId: `inv_integration_${suffix}`,
  requiredAmount: '1000000',
  recipient: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  payload: {
    // NOTE: real signature required for on-chain settle — mocked here
    signature: '0x' + suffix.padEnd(130, '0'),
    authorization: {
      from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      to:   '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      value: '1000000',
      validAfter:  0,
      validBefore: Math.floor(Date.now() / 1000) + 3600,
      nonce: '0x' + suffix.padEnd(64, '0'),
    },
  },
})

beforeAll(async () => {
  if (SKIP) return
  await prisma.$connect()
})

afterAll(async () => {
  if (SKIP) return
  await prisma.$disconnect()
  await redis.quit()
})

describe.skipIf(SKIP)('Integration: verify → settle → receipt', () => {
  it('full happy path: verify accepted, settle confirmed, receipt accessible', async () => {
    const suffix = Date.now().toString(16)

    // 1. Verify — mock signature verifier
    const { vi } = await import('vitest')
    vi.mock('../../src/crypto/signature-verifier.js', () => ({
      verifyErc3009Signature: vi.fn(async ({ authorization }: any) => authorization.from),
      computeSignatureHash: (sig: string) => sig.toLowerCase(),
    }))

    const verifyResult = await verifyPayment(VALID_BODY(suffix), {
      prisma, redis, logger, networkRegistry: NETWORK_REGISTRY,
    })

    expect(verifyResult.status).toBe('accepted')
    const { paymentRequestId } = verifyResult

    // 2. Settle — mock on-chain sender
    vi.mock('../../src/settlement/on-chain-sender.js', () => ({
      sendTransferWithAuthorization: vi.fn(async () => ({
        txHash: '0x' + 'f'.repeat(64),
        blockNumber: BigInt(999),
        gasUsed: BigInt(80000),
      })),
    }))

    const settleResult = await settlePayment(
      { paymentRequestId },
      { prisma, redis, logger, networkRegistry: NETWORK_REGISTRY, relayerPrivateKey: '0x' + 'a'.repeat(64) },
    )

    expect(settleResult.settled).toBe(true)
    if (!settleResult.settled) throw new Error('not settled')
    expect(settleResult.status).toBe('confirmed')
    const { receiptId } = settleResult

    // 3. Receipt
    const receipt = await getReceiptById(receiptId, prisma, logger)
    expect(receipt.receiptId).toBe(receiptId)
    expect(receipt.requestId).toBe(paymentRequestId)
    expect(receipt.txHash).toMatch(/^0x/)
    expect(receipt.amount).toBe('1000000')
  })

  it('idempotence: calling settle twice returns same txHash', async () => {
    const suffix = (Date.now() + 1).toString(16)
    const { vi } = await import('vitest')

    vi.mock('../../src/crypto/signature-verifier.js', () => ({
      verifyErc3009Signature: vi.fn(async ({ authorization }: any) => authorization.from),
      computeSignatureHash: (sig: string) => sig.toLowerCase(),
    }))

    const verifyResult = await verifyPayment(VALID_BODY(suffix), {
      prisma, redis, logger, networkRegistry: NETWORK_REGISTRY,
    })
    const { paymentRequestId } = verifyResult

    vi.mock('../../src/settlement/on-chain-sender.js', () => ({
      sendTransferWithAuthorization: vi.fn(async () => ({
        txHash: '0x' + 'e'.repeat(64),
        blockNumber: BigInt(1001),
        gasUsed: BigInt(80000),
      })),
    }))

    const deps = { prisma, redis, logger, networkRegistry: NETWORK_REGISTRY, relayerPrivateKey: '0x' + 'a'.repeat(64) }

    const r1 = await settlePayment({ paymentRequestId }, deps)
    const r2 = await settlePayment({ paymentRequestId }, deps)

    expect(r1.settled).toBe(true)
    expect(r2.settled).toBe(true)
    if (r1.settled && r2.settled) {
      expect(r1.txHash).toBe(r2.txHash)
      expect(r2._idempotent).toBe(true)
    }
  })

  it('anti-replay: same nonce rejected on second verify', async () => {
    const suffix = (Date.now() + 2).toString(16)
    const { vi } = await import('vitest')

    vi.mock('../../src/crypto/signature-verifier.js', () => ({
      verifyErc3009Signature: vi.fn(async ({ authorization }: any) => authorization.from),
      computeSignatureHash: (sig: string) => sig.toLowerCase(),
    }))

    const body = VALID_BODY(suffix)
    await verifyPayment(body, { prisma, redis, logger, networkRegistry: NETWORK_REGISTRY })

    // Second verify with same nonce
    await expect(
      verifyPayment({ ...body, invoiceId: `inv_replay_${suffix}` }, {
        prisma, redis, logger, networkRegistry: NETWORK_REGISTRY,
      })
    ).rejects.toMatchObject({ code: 'duplicate_payment' })
  })
})
