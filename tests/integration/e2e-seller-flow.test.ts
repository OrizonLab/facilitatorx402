/**
 * Integration tests — End-to-end seller flow (OBLIGATOIRE)
 *
 * Reproduit le flux complet :
 *   1. Seller retourne 402 Payment Required (simulé)
 *   2. Client envoie le payload au facilitateur via POST /verify
 *   3. POST /settle règle la transaction
 *   4. L’accès est accordé (status confirmed)
 *   5. Le reçu est consultable via GET /receipts/:id
 *   6. Le recu contient tous les champs audit
 *
 * Varie les nonces pour éviter les collisions entre tests.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { buildApp } from '../../src/http/app.js'
import { db } from '../../src/infrastructure/db.js'
import { getRedis } from '../../src/infrastructure/redis.js'
import { buildValidX402Payload } from '../helpers/payload-builder.js'

vi.mock('../../src/crypto/signature-verifier.js', () => ({
  verifyTransferAuthorization: vi.fn().mockResolvedValue({ valid: true }),
}))

vi.mock('../../src/settlement/on-chain.js', () => ({
  submitOnChain: vi.fn().mockResolvedValue({
    txHash: '0xe2e0000000000000000000000000000000000000000000000000000000000001',
  }),
}))

describe('E2E Seller Flow — verify → settle → receipt', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await getRedis().flushdb()
    await db.paymentReceipt.deleteMany()
    await db.paymentSettlement.deleteMany()
    await db.paymentVerification.deleteMany()
    await db.paymentRequest.deleteMany()
  })

  afterAll(async () => {
    await app.close()
  })

  it('complete flow: verify → settle → receipt', async () => {
    /**
     * Step 1: Seller returns 402 (simulated)
     * In a real integration, the seller API would return:
     *   HTTP 402
     *   x-payment-required: { network, asset, requiredAmount, recipient, invoiceId }
     *
     * The client then builds the x402 payload and sends it to the facilitator.
     */
    const x402Payload = buildValidX402Payload({ nonce: '0x' + '30'.repeat(32) })

    /**
     * Step 2: POST /verify — facilitator validates the proof
     */
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/verify',
      payload: x402Payload,
    })

    expect(verifyRes.statusCode).toBe(200)
    const verifyBody = verifyRes.json()
    expect(verifyBody.status).toBe('accepted')
    expect(verifyBody.verificationId).toBeDefined()
    expect(verifyBody.paymentRequestId).toBeDefined()
    expect(verifyBody.network).toBeDefined()
    expect(verifyBody.asset).toBeDefined()
    expect(verifyBody.verifiedAt).toBeDefined()

    /**
     * Step 3: POST /settle — facilitator settles on-chain
     */
    const settleRes = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: {
        requestId: verifyBody.paymentRequestId,
        verificationId: verifyBody.verificationId,
      },
    })

    expect(settleRes.statusCode).toBe(200)
    const settleBody = settleRes.json()
    expect(settleBody.status).toBe('confirmed')
    expect(settleBody.txHash).toBeDefined()
    expect(settleBody.settlementId).toBeDefined()
    expect(settleBody.receiptId).toBeDefined()
    expect(settleBody.feeAmount).toBeDefined()
    expect(settleBody.confirmedAt).toBeDefined()

    /**
     * Step 4: Access granted — seller checks the settled status
     * (In production, seller would verify txHash on-chain or call GET /receipts/:id)
     */
    expect(settleBody.status).toBe('confirmed')

    /**
     * Step 5: GET /receipts/:id — receipt is available for audit
     */
    const receiptRes = await app.inject({
      method: 'GET',
      url: `/receipts/${settleBody.receiptId}`,
    })

    expect(receiptRes.statusCode).toBe(200)
    const receipt = receiptRes.json()

    /**
     * Step 6: Receipt contains all audit fields
     */
    expect(receipt.id).toBe(settleBody.receiptId)
    expect(receipt.requestId).toBe(verifyBody.paymentRequestId)
    expect(receipt.protocolVersion).toBe('x402-v1')
    expect(receipt.responsePayload.txHash).toBe(settleBody.txHash)
    expect(receipt.responsePayload.network).toBeDefined()
    expect(receipt.responsePayload.asset).toBeDefined()
    expect(receipt.responsePayload.grossAmount).toBeDefined()
    expect(receipt.responsePayload.feeAmount).toBeDefined()
    expect(receipt.responsePayload.netAmount).toBeDefined()
    expect(receipt.responsePayload.confirmedAt).toBeDefined()
  })

  it('verify is idempotent — second verify with same nonce is rejected', async () => {
    const nonce = '0x' + '31'.repeat(32)
    const payload = buildValidX402Payload({ nonce })

    const r1 = await app.inject({ method: 'POST', url: '/verify', payload })
    expect(r1.statusCode).toBe(200)

    const r2 = await app.inject({ method: 'POST', url: '/verify', payload })
    expect(r2.statusCode).toBe(409)
    expect(r2.json().error.code).toBe('duplicate_payment')
  })

  it('settle is idempotent — same requestId + verificationId returns same receipt', async () => {
    const nonce = '0x' + '32'.repeat(32)
    const payload = buildValidX402Payload({ nonce })

    const verifyRes = await app.inject({ method: 'POST', url: '/verify', payload })
    const { verificationId, paymentRequestId } = verifyRes.json()

    const s1 = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: paymentRequestId, verificationId },
    })
    const s2 = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: paymentRequestId, verificationId },
    })

    expect(s1.json().receiptId).toBe(s2.json().receiptId)
    expect(s1.json().txHash).toBe(s2.json().txHash)
    expect(s1.json().settlementId).toBe(s2.json().settlementId)
  })

  it('metrics endpoint remains accessible throughout the flow', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' })
    expect(res.statusCode).toBe(200)
    // Prometheus text format
    expect(res.headers['content-type']).toContain('text/plain')
  })

  it('supported endpoint exposes the expected network and asset', async () => {
    const res = await app.inject({ method: 'GET', url: '/supported' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('networks')
    expect(Array.isArray(body.networks)).toBe(true)
    expect(body.networks.length).toBeGreaterThan(0)
  })
})
