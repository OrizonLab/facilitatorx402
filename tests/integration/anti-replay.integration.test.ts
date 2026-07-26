/**
 * Integration tests — Anti-replay protection (deep)
 *
 * Covers:
 *   - Nonce uniqueness enforced via Redis
 *   - Nonce uniqueness enforced via PostgreSQL (Redis flush simulation)
 *   - Signature hash uniqueness enforced
 *   - Concurrent duplicate requests: only one should succeed
 *   - Anti-replay persists across app restarts (PostgreSQL layer)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildApp } from '../../src/http/app.js'
import { db } from '../../src/infrastructure/db.js'
import { getRedis } from '../../src/infrastructure/redis.js'
import { buildValidX402Payload } from '../helpers/payload-builder.js'

vi.mock('../../src/crypto/signature-verifier.js', () => ({
  verifyTransferAuthorization: vi.fn().mockResolvedValue({ valid: true }),
}))

describe('Anti-replay protection', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    app = await buildApp()
    await app.ready()
    await getRedis().flushdb()
    await db.paymentVerification.deleteMany()
    await db.paymentRequest.deleteMany()
  })

  afterEach(async () => {
    await app.close()
  })

  it('rejects the same nonce submitted twice', async () => {
    const nonce = '0x' + '01'.repeat(32)
    const payload = buildValidX402Payload({ nonce })

    const r1 = await app.inject({ method: 'POST', url: '/verify', payload })
    expect(r1.statusCode).toBe(200)

    const r2 = await app.inject({ method: 'POST', url: '/verify', payload })
    expect(r2.statusCode).toBe(409)
    expect(r2.json().error.code).toBe('duplicate_payment')
  })

  it('rejects the same signature hash even with a different nonce field', async () => {
    // Same signature string → same hash → should be rejected
    const basePayload = buildValidX402Payload({ nonce: '0x' + '02'.repeat(32) })

    const r1 = await app.inject({ method: 'POST', url: '/verify', payload: basePayload })
    expect(r1.statusCode).toBe(200)

    // Change nonce in authorization but keep exact same signature bytes
    const payloadSameSig = {
      ...basePayload,
      payload: {
        ...basePayload.payload,
        authorization: {
          ...basePayload.payload.authorization,
          nonce: '0x' + '03'.repeat(32), // different nonce
        },
        // signature unchanged → same hash
      },
    }

    const r2 = await app.inject({ method: 'POST', url: '/verify', payload: payloadSameSig })
    expect(r2.statusCode).toBe(409)
    expect(r2.json().error.code).toBe('duplicate_payment')
  })

  it('survives Redis flush — PostgreSQL layer blocks the duplicate', async () => {
    const nonce = '0x' + '04'.repeat(32)
    const payload = buildValidX402Payload({ nonce })

    // First request succeeds
    const r1 = await app.inject({ method: 'POST', url: '/verify', payload })
    expect(r1.statusCode).toBe(200)

    // Simulate Redis restart
    await getRedis().flushdb()

    // Second request still blocked by PostgreSQL
    const r2 = await app.inject({ method: 'POST', url: '/verify', payload })
    expect(r2.statusCode).toBe(409)
    expect(r2.json().error.code).toBe('duplicate_payment')
  })

  it('handles concurrent duplicate requests — only one succeeds', async () => {
    const nonce = '0x' + '05'.repeat(32)
    const payload = buildValidX402Payload({ nonce })

    // Fire 5 concurrent requests with the same payload
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({ method: 'POST', url: '/verify', payload })
      )
    )

    const accepted = results.filter((r) => r.statusCode === 200)
    const rejected = results.filter((r) => r.statusCode === 409)

    // Exactly one must succeed
    expect(accepted).toHaveLength(1)
    expect(rejected.length).toBeGreaterThanOrEqual(4)
  })

  it('different nonces are independently accepted', async () => {
    const payloads = [
      buildValidX402Payload({ nonce: '0x' + '06'.repeat(32) }),
      buildValidX402Payload({ nonce: '0x' + '07'.repeat(32) }),
      buildValidX402Payload({ nonce: '0x' + '08'.repeat(32) }),
    ]

    const results = await Promise.all(
      payloads.map((p) => app.inject({ method: 'POST', url: '/verify', payload: p }))
    )

    results.forEach((r) => {
      expect(r.statusCode).toBe(200)
      expect(r.json().status).toBe('accepted')
    })
  })
})
