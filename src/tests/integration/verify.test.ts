import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { buildApp } from '../../http/app.js'
import type { FastifyInstance } from 'fastify'

// Mock on-chain signature verification for unit-style integration tests
vi.mock('../../crypto/signature-verifier.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../crypto/signature-verifier.js')>()
  return {
    ...original,
    verifySignature: vi.fn().mockResolvedValue(undefined), // always valid
  }
})

const validPayload = {
  version: 'x402/v1',
  network: { chainId: 8453 },
  asset: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  amount: '1000000',
  seller: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  buyer: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  invoiceId: `inv_test_${Date.now()}`,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  nonce: `nonce_${Date.now()}_${Math.random()}`,
  signature: '0x' + 'a'.repeat(130),
  scheme: 'erc20-transfer',
}

describe('POST /verify', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('should accept a valid payment proof', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/verify',
      payload: { ...validPayload, nonce: `nonce_valid_${Date.now()}` },
    })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body) as Record<string, unknown>
    expect(body.accepted).toBe(true)
    expect(body).toHaveProperty('requestId')
    expect(body).toHaveProperty('verificationId')
  })

  it('should reject with unsupported_network for wrong chainId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/verify',
      payload: { ...validPayload, network: { chainId: 1 }, nonce: `nonce_net_${Date.now()}` },
    })
    expect(response.statusCode).toBe(422)
    const body = JSON.parse(response.body) as { error: { code: string } }
    expect(body.error.code).toBe('unsupported_network')
  })

  it('should reject an expired payment proof', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/verify',
      payload: {
        ...validPayload,
        expiresAt: new Date(Date.now() - 120_000).toISOString(),
        nonce: `nonce_exp_${Date.now()}`,
      },
    })
    expect(response.statusCode).toBe(422)
    const body = JSON.parse(response.body) as { error: { code: string } }
    expect(body.error.code).toBe('expired_payment')
  })

  it('should reject a duplicate payment (same nonce)', async () => {
    const nonce = `nonce_dup_${Date.now()}`
    const sig = '0x' + 'b'.repeat(130)

    // First call — should succeed
    await app.inject({
      method: 'POST',
      url: '/verify',
      payload: { ...validPayload, nonce, signature: sig },
    })

    // Second call with same nonce — should be rejected
    const response = await app.inject({
      method: 'POST',
      url: '/verify',
      payload: { ...validPayload, nonce, signature: sig, invoiceId: `inv_dup2_${Date.now()}` },
    })
    expect(response.statusCode).toBe(409)
    const body = JSON.parse(response.body) as { error: { code: string } }
    expect(body.error.code).toBe('duplicate_payment')
  })

  it('should reject a malformed body with validation_error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/verify',
      payload: { version: 'x402/v1' }, // missing required fields
    })
    expect(response.statusCode).toBe(400)
    const body = JSON.parse(response.body) as { error: { code: string } }
    expect(body.error.code).toBe('validation_error')
  })
})
