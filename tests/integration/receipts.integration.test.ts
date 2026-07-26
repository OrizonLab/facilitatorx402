/**
 * Integration tests — GET /receipts/:id
 *
 * Covers:
 *   - Returns 200 with full receipt for existing receiptId
 *   - Returns 404 for unknown id
 *   - Receipt shape is stable and audit-ready
 *   - Receipt is persisted after a successful settle
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildApp } from '../../src/http/app.js'
import { db } from '../../src/infrastructure/db.js'
import { getRedis } from '../../src/infrastructure/redis.js'
import { buildValidX402Payload } from '../helpers/payload-builder.js'
import { ulid } from 'ulid'

vi.mock('../../src/crypto/signature-verifier.js', () => ({
  verifyTransferAuthorization: vi.fn().mockResolvedValue({ valid: true }),
}))

vi.mock('../../src/settlement/on-chain.js', () => ({
  submitOnChain: vi.fn().mockResolvedValue({
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  }),
}))

describe('GET /receipts/:id', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
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

  it('returns 404 for an unknown receipt id', async () => {
    const res = await app.inject({ method: 'GET', url: `/receipts/${ulid()}` })
    expect(res.statusCode).toBe(404)
  })

  it('returns a full receipt after verify + settle', async () => {
    const payload = buildValidX402Payload({ nonce: '0x' + 'ee'.repeat(32) })

    // Step 1: verify
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/verify',
      payload,
    })
    expect(verifyRes.statusCode).toBe(200)
    const { verificationId, paymentRequestId } = verifyRes.json()

    // Step 2: settle
    const settleRes = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: paymentRequestId, verificationId },
    })
    expect(settleRes.statusCode).toBe(200)
    const { receiptId } = settleRes.json()
    expect(receiptId).toBeDefined()

    // Step 3: get receipt
    const receiptRes = await app.inject({
      method: 'GET',
      url: `/receipts/${receiptId}`,
    })
    expect(receiptRes.statusCode).toBe(200)

    const receipt = receiptRes.json()
    expect(receipt).toHaveProperty('id')
    expect(receipt).toHaveProperty('requestId')
    expect(receipt).toHaveProperty('protocolVersion')
    expect(receipt).toHaveProperty('responsePayload')
    expect(receipt.responsePayload).toHaveProperty('txHash')
    expect(receipt.responsePayload).toHaveProperty('feeAmount')
    expect(receipt.responsePayload).toHaveProperty('netAmount')
  })

  it('receipt responsePayload contains all required audit fields', async () => {
    const payload = buildValidX402Payload({ nonce: '0x' + 'ff'.repeat(32) })

    const verifyRes = await app.inject({ method: 'POST', url: '/verify', payload })
    const { verificationId, paymentRequestId } = verifyRes.json()

    const settleRes = await app.inject({
      method: 'POST',
      url: '/settle',
      payload: { requestId: paymentRequestId, verificationId },
    })
    const { receiptId } = settleRes.json()

    const res = await app.inject({ method: 'GET', url: `/receipts/${receiptId}` })
    const receipt = res.json()

    const rp = receipt.responsePayload
    expect(rp).toHaveProperty('settlementId')
    expect(rp).toHaveProperty('txHash')
    expect(rp).toHaveProperty('network')
    expect(rp).toHaveProperty('asset')
    expect(rp).toHaveProperty('grossAmount')
    expect(rp).toHaveProperty('feeAmount')
    expect(rp).toHaveProperty('developerShare')
    expect(rp).toHaveProperty('netAmount')
    expect(rp).toHaveProperty('feeBps')
    expect(rp).toHaveProperty('confirmedAt')
  })
})
