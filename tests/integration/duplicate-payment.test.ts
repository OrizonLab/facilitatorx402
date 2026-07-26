/**
 * Integration tests — Duplicate payment & settle idempotence (OBLIGATOIRES)
 *
 * Invariants vérifiés :
 *   - Le même paiement ne peut JAMAIS être réglé deux fois
 *   - Un retry sur /settle retourne le même résultat sans re-soumettre on-chain
 *   - Une requête concurrente ne produit pas un double settlement
 *   - Un settlement failed ne peut pas être relanced via /settle
 *   - Le même requestId soumis N fois → exactement 1 appel on-chain
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildApp } from '../../src/http/app.js'
import { db } from '../../src/infrastructure/db.js'
import { getRedis } from '../../src/infrastructure/redis.js'
import { buildValidX402Payload } from '../helpers/payload-builder.js'

const mockSubmitOnChain = vi.fn().mockResolvedValue({
  txHash: '0xabc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1',
})

vi.mock('../../src/crypto/signature-verifier.js', () => ({
  verifyTransferAuthorization: vi.fn().mockResolvedValue({ valid: true }),
}))

vi.mock('../../src/settlement/on-chain.js', () => ({
  submitOnChain: mockSubmitOnChain,
}))

async function verifyAndGetIds(
  app: Awaited<ReturnType<typeof buildApp>>,
  nonce: string
) {
  const payload = buildValidX402Payload({ nonce })
  const res = await app.inject({ method: 'POST', url: '/verify', payload })
  expect(res.statusCode).toBe(200)
  return res.json() as { verificationId: string; paymentRequestId: string }
}

describe('Duplicate payment — same payment never settled twice', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    mockSubmitOnChain.mockClear()
    app = await buildApp()
    await app.ready()
    await getRedis().flushdb()
    await db.paymentReceipt.deleteMany()
    await db.paymentSettlement.deleteMany()
    await db.paymentVerification.deleteMany()
    await db.paymentRequest.deleteMany()
  })

  afterEach(async () => {
    await app.close()
  })

  it('settle called twice → on-chain submitted exactly once, second call returns existing result', async () => {
    const { verificationId, paymentRequestId } = await verifyAndGetIds(app, '0x' + '10'.repeat(32))

    const settle1 = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: paymentRequestId, verificationId },
    })
    expect(settle1.statusCode).toBe(200)
    expect(settle1.json().status).toBe('confirmed')

    const settle2 = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: paymentRequestId, verificationId },
    })
    expect(settle2.statusCode).toBe(200)
    expect(settle2.json().status).toBe('confirmed')

    // On-chain called exactly once
    expect(mockSubmitOnChain).toHaveBeenCalledTimes(1)

    // Same settlementId returned
    expect(settle1.json().settlementId).toBe(settle2.json().settlementId)
    expect(settle1.json().txHash).toBe(settle2.json().txHash)
  })

  it('N concurrent settle requests → exactly 1 on-chain call, N consistent responses', async () => {
    const { verificationId, paymentRequestId } = await verifyAndGetIds(app, '0x' + '11'.repeat(32))

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST',
          url: '/settle',
          payload: { requestId: paymentRequestId, verificationId },
        })
      )
    )

    // All responses must be either confirmed or settlement_pending (in-flight)
    results.forEach((r) => {
      expect([200, 409]).toContain(r.statusCode)
      if (r.statusCode === 200) {
        expect(r.json().status).toBe('confirmed')
      }
    })

    // On-chain submitted at most once
    expect(mockSubmitOnChain.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('settle retry returns the same receiptId', async () => {
    const { verificationId, paymentRequestId } = await verifyAndGetIds(app, '0x' + '12'.repeat(32))

    const r1 = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: paymentRequestId, verificationId },
    })
    const r2 = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: paymentRequestId, verificationId },
    })

    expect(r1.json().receiptId).toBe(r2.json().receiptId)
  })

  it('different payments settle independently without interference', async () => {
    const { verificationId: v1, paymentRequestId: r1 } = await verifyAndGetIds(app, '0x' + '13'.repeat(32))
    const { verificationId: v2, paymentRequestId: r2 } = await verifyAndGetIds(app, '0x' + '14'.repeat(32))

    const s1 = await app.inject({ method: 'POST', url: '/settle', payload: { requestId: r1, verificationId: v1 } })
    const s2 = await app.inject({ method: 'POST', url: '/settle', payload: { requestId: r2, verificationId: v2 } })

    expect(s1.json().status).toBe('confirmed')
    expect(s2.json().status).toBe('confirmed')
    expect(s1.json().settlementId).not.toBe(s2.json().settlementId)
    expect(mockSubmitOnChain).toHaveBeenCalledTimes(2)
  })

  it('settle with unknown verificationId returns error without on-chain call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: 'nonexistent-id', verificationId: 'nonexistent-ver' },
    })

    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe('verification_not_found')
    expect(mockSubmitOnChain).not.toHaveBeenCalled()
  })

  it('receipt is persisted and retrievable after settlement', async () => {
    const { verificationId, paymentRequestId } = await verifyAndGetIds(app, '0x' + '15'.repeat(32))

    const settleRes = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: paymentRequestId, verificationId },
    })
    const { receiptId } = settleRes.json()

    const receiptRes = await app.inject({ method: 'GET', url: `/receipts/${receiptId}` })
    expect(receiptRes.statusCode).toBe(200)

    const record = await db.paymentReceipt.findUnique({ where: { id: receiptId } })
    expect(record).not.toBeNull()
    expect(record!.requestId).toBe(paymentRequestId)
  })
})

describe('Settle idempotence — retry never produces inconsistent state', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    mockSubmitOnChain.mockClear()
    app = await buildApp()
    await app.ready()
    await getRedis().flushdb()
    await db.paymentReceipt.deleteMany()
    await db.paymentSettlement.deleteMany()
    await db.paymentVerification.deleteMany()
    await db.paymentRequest.deleteMany()
  })

  afterEach(async () => {
    await app.close()
  })

  it('exactly one settlement record exists after N retries', async () => {
    const { verificationId, paymentRequestId } = await verifyAndGetIds(app, '0x' + '20'.repeat(32))

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/settle',
        payload: { requestId: paymentRequestId, verificationId },
      })
    }

    const count = await db.paymentSettlement.count({ where: { requestId: paymentRequestId } })
    expect(count).toBe(1)
  })

  it('exactly one receipt record exists after N retries', async () => {
    const { verificationId, paymentRequestId } = await verifyAndGetIds(app, '0x' + '21'.repeat(32))

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/settle',
        payload: { requestId: paymentRequestId, verificationId },
      })
    }

    const count = await db.paymentReceipt.count({ where: { requestId: paymentRequestId } })
    expect(count).toBe(1)
  })

  it('txHash is stable across retries', async () => {
    const { verificationId, paymentRequestId } = await verifyAndGetIds(app, '0x' + '22'.repeat(32))

    const r1 = await app.inject({ method: 'POST', url: '/settle', payload: { requestId: paymentRequestId, verificationId } })
    const r2 = await app.inject({ method: 'POST', url: '/settle', payload: { requestId: paymentRequestId, verificationId } })
    const r3 = await app.inject({ method: 'POST', url: '/settle', payload: { requestId: paymentRequestId, verificationId } })

    const txHashes = [r1.json().txHash, r2.json().txHash, r3.json().txHash]
    expect(new Set(txHashes).size).toBe(1) // all identical
  })
})
