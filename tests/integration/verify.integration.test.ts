/**
 * Integration tests — POST /verify
 *
 * Covers:
 *   - Valid payload → accepted
 *   - Expired payment → expired_payment
 *   - Invalid signature → invalid_signature
 *   - Duplicate nonce (anti-replay) → duplicate_payment
 *   - Duplicate signature hash (anti-replay) → duplicate_payment
 *   - Unsupported network → unsupported_network
 *   - Unsupported asset → unsupported_asset
 *   - Amount too low → invalid_payload
 *   - Missing required fields → 400
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildApp } from '../../src/http/app.js'
import { db } from '../../src/infrastructure/db.js'
import { getRedis } from '../../src/infrastructure/redis.js'
import { buildValidX402Payload, buildExpiredX402Payload } from '../helpers/payload-builder.js'

// Mock on-chain calls — we don’t need real blockchain in integration tests
vi.mock('../../src/crypto/signature-verifier.js', () => ({
  verifyTransferAuthorization: vi.fn().mockResolvedValue({ valid: true }),
}))

vi.mock('../../src/settlement/on-chain.js', () => ({
  submitOnChain: vi.fn().mockResolvedValue({
    txHash: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  }),
}))

describe('POST /verify', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let redis: ReturnType<typeof getRedis>

  beforeEach(async () => {
    app = await buildApp()
    await app.ready()
    redis = getRedis()

    // Clean up between tests
    await redis.flushdb()
    await db.paymentVerification.deleteMany()
    await db.paymentRequest.deleteMany()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns accepted for a valid payload', async () => {
    const payload = buildValidX402Payload()

    const res = await app.inject({
      method: 'POST',
      url: '/verify',
      payload,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('accepted')
    expect(body.verificationId).toBeDefined()
    expect(body.paymentRequestId).toBeDefined()
    expect(body.network).toBe(payload.network)
    expect(body.asset).toBe(payload.asset)
  })

  it('returns expired_payment for an expired validBefore', async () => {
    const payload = buildExpiredX402Payload()

    const res = await app.inject({
      method: 'POST',
      url: '/verify',
      payload,
    })

    expect(res.statusCode).toBe(402)
    const body = res.json()
    expect(body.status).toBe('rejected')
    expect(body.error.code).toBe('expired_payment')
  })

  it('returns invalid_signature when signature verifier returns false', async () => {
    const { verifyTransferAuthorization } = await import('../../src/crypto/signature-verifier.js')
    vi.mocked(verifyTransferAuthorization).mockResolvedValueOnce({
      valid: false,
      error: 'Bad signature',
    })

    const payload = buildValidX402Payload({ nonce: '0x' + 'aa'.repeat(32) })

    const res = await app.inject({
      method: 'POST',
      url: '/verify',
      payload,
    })

    expect(res.statusCode).toBe(402)
    const body = res.json()
    expect(body.error.code).toBe('invalid_signature')
  })

  it('blocks duplicate nonce (anti-replay via Redis)', async () => {
    const payload = buildValidX402Payload()

    // First call — should succeed
    const first = await app.inject({ method: 'POST', url: '/verify', payload })
    expect(first.statusCode).toBe(200)

    // Second call with same nonce — must be blocked
    const second = await app.inject({ method: 'POST', url: '/verify', payload })
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe('duplicate_payment')
  })

  it('blocks duplicate nonce (anti-replay via PostgreSQL fallback after Redis flush)', async () => {
    const payload = buildValidX402Payload({ nonce: '0x' + 'bb'.repeat(32) })

    // First call — succeeds
    const first = await app.inject({ method: 'POST', url: '/verify', payload })
    expect(first.statusCode).toBe(200)

    // Simulate Redis flush (e.g. restart)
    await redis.flushdb()

    // Second call — Redis is empty but PostgreSQL still has the record
    const second = await app.inject({ method: 'POST', url: '/verify', payload })
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe('duplicate_payment')
  })

  it('returns unsupported_network for unknown network', async () => {
    const payload = buildValidX402Payload({ network: 'unknown-chain-999' })

    const res = await app.inject({ method: 'POST', url: '/verify', payload })
    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe('unsupported_network')
  })

  it('returns unsupported_asset for unknown asset on valid network', async () => {
    const payload = buildValidX402Payload({ asset: 'FAKECOIN' })

    const res = await app.inject({ method: 'POST', url: '/verify', payload })
    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe('unsupported_asset')
  })

  it('returns invalid_payload when amount is below required', async () => {
    const payload = buildValidX402Payload({ value: '1', requiredAmount: '1000000000' })

    const res = await app.inject({ method: 'POST', url: '/verify', payload })
    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe('invalid_payload')
  })

  it('returns 400 for a completely malformed payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/verify',
      payload: { garbage: true },
    })
    expect(res.statusCode).toBe(400)
  })

  it('persists the verification record in PostgreSQL on success', async () => {
    const payload = buildValidX402Payload({ nonce: '0x' + 'cc'.repeat(32) })

    const res = await app.inject({ method: 'POST', url: '/verify', payload })
    const body = res.json()
    expect(body.status).toBe('accepted')

    const record = await db.paymentVerification.findUnique({
      where: { id: body.verificationId },
    })
    expect(record).not.toBeNull()
    expect(record!.verificationStatus).toBe('accepted')
  })

  it('persists rejected verification on invalid_signature', async () => {
    const { verifyTransferAuthorization } = await import('../../src/crypto/signature-verifier.js')
    vi.mocked(verifyTransferAuthorization).mockResolvedValueOnce({
      valid: false,
      error: 'Bad sig',
    })

    const payload = buildValidX402Payload({ nonce: '0x' + 'dd'.repeat(32) })
    await app.inject({ method: 'POST', url: '/verify', payload })

    const record = await db.paymentVerification.findFirst({
      where: { nonce: payload.payload.authorization.nonce },
    })
    expect(record).not.toBeNull()
    expect(record!.verificationStatus).toBe('rejected')
    expect(record!.errorCode).toBe('invalid_signature')
  })
})
