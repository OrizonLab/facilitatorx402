import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FacilitatorClient } from '../client.js'
import { FacilitatorAPIError, FacilitatorTimeoutError } from '../errors.js'
import type { X402PaymentProof } from '../types.js'

const BASE_PROOF: X402PaymentProof = {
  x402Version: 1,
  scheme: 'exact',
  network: 'base',
  asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  recipient: '0xabc1234567890abcdef1234567890abcdef123456',
  amount: '1000000',
  invoiceId: 'inv_test_001',
  expiresAt: Math.floor(Date.now() / 1000) + 300,
  signature: '0xdeadbeef',
  nonce: 'nonce_test_001',
  payer: '0xdef1234567890abcdef1234567890abcdef123456',
}

function makeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

describe('FacilitatorClient', () => {
  describe('verify()', () => {
    it('returns accepted on valid proof', async () => {
      const mockFetch = makeFetch(200, {
        status: 'accepted',
        requestId: 'req_001',
        verificationId: 'ver_001',
      })
      const client = new FacilitatorClient({ url: 'http://localhost:3000', fetch: mockFetch })
      const result = await client.verify(BASE_PROOF)
      expect(result.status).toBe('accepted')
      expect(result.requestId).toBe('req_001')
    })

    it('throws FacilitatorAPIError on invalid_signature', async () => {
      const mockFetch = makeFetch(400, {
        error: { code: 'invalid_signature', reason: 'Signature mismatch', message: 'Invalid signature', status: 400 },
      })
      const client = new FacilitatorClient({ url: 'http://localhost:3000', fetch: mockFetch, retries: 0 })
      await expect(client.verify(BASE_PROOF)).rejects.toThrow(FacilitatorAPIError)
    })

    it('throws FacilitatorAPIError on duplicate_payment', async () => {
      const mockFetch = makeFetch(409, {
        error: { code: 'duplicate_payment', reason: 'Already seen', message: 'Duplicate payment', status: 409 },
      })
      const client = new FacilitatorClient({ url: 'http://localhost:3000', fetch: mockFetch, retries: 0 })
      const err = await client.verify(BASE_PROOF).catch((e) => e)
      expect(err).toBeInstanceOf(FacilitatorAPIError)
      expect((err as FacilitatorAPIError).isDuplicate()).toBe(true)
    })

    it('throws FacilitatorTimeoutError on timeout', async () => {
      const mockFetch = vi.fn().mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 50))
      )
      const client = new FacilitatorClient({ url: 'http://localhost:3000', fetch: mockFetch, timeout: 10, retries: 0 })
      await expect(client.verify(BASE_PROOF)).rejects.toThrow(FacilitatorTimeoutError)
    })
  })

  describe('settle()', () => {
    it('returns confirmed on valid requestId', async () => {
      const mockFetch = makeFetch(200, {
        status: 'confirmed',
        settlementId: 'stl_001',
        requestId: 'req_001',
        receiptId: 'rcp_001',
        txHash: '0xabc',
      })
      const client = new FacilitatorClient({ url: 'http://localhost:3000', fetch: mockFetch })
      const result = await client.settle('req_001')
      expect(result.status).toBe('confirmed')
      expect(result.receiptId).toBe('rcp_001')
    })

    it('idempotent — duplicate_settlement returns existing result gracefully', async () => {
      const mockFetch = makeFetch(200, {
        status: 'confirmed',
        settlementId: 'stl_001',
        requestId: 'req_001',
        receiptId: 'rcp_001',
      })
      const client = new FacilitatorClient({ url: 'http://localhost:3000', fetch: mockFetch })
      const r1 = await client.settle('req_001')
      const r2 = await client.settle('req_001')
      expect(r1.settlementId).toBe(r2.settlementId)
    })
  })

  describe('pay()', () => {
    it('calls verify then settle and returns both', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ status: 'accepted', requestId: 'req_001', verificationId: 'ver_001' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ status: 'confirmed', settlementId: 'stl_001', requestId: 'req_001', receiptId: 'rcp_001' }) })
      const client = new FacilitatorClient({ url: 'http://localhost:3000', fetch: mockFetch })
      const result = await client.pay(BASE_PROOF)
      expect(result.verify.status).toBe('accepted')
      expect(result.settle.status).toBe('confirmed')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('throws immediately if verify is rejected — does not call settle', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve({ status: 'rejected', requestId: 'req_001', verificationId: 'ver_001', errorCode: 'expired_payment', reason: 'expired' }),
      })
      const client = new FacilitatorClient({ url: 'http://localhost:3000', fetch: mockFetch })
      await expect(client.pay(BASE_PROOF)).rejects.toThrow(FacilitatorAPIError)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('FacilitatorAPIError helpers', () => {
    it('isRetryable() returns true for internal_error', () => {
      const err = new FacilitatorAPIError({ code: 'internal_error', reason: 'x', message: 'x', status: 500 })
      expect(err.isRetryable()).toBe(true)
    })
    it('isExpired() returns true for expired_payment', () => {
      const err = new FacilitatorAPIError({ code: 'expired_payment', reason: 'x', message: 'x', status: 402 })
      expect(err.isExpired()).toBe(true)
    })
  })
})
