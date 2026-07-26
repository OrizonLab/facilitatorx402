import { describe, it, expect } from 'vitest'
import { buildSignedMessage, computeSignatureHash, computePayloadHash } from '../../crypto/signature-verifier.js'

describe('buildSignedMessage', () => {
  it('should produce a deterministic message from params', () => {
    const params = {
      chainId: 8453,
      assetAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      amount: '1000000',
      seller: '0xseller',
      invoiceId: 'inv_001',
      expiresAt: '2030-01-01T00:00:00Z',
      nonce: 'nonce_001',
    }
    const msg1 = buildSignedMessage(params)
    const msg2 = buildSignedMessage(params)
    expect(msg1).toBe(msg2)
    expect(msg1).toContain('x402')
    expect(msg1).toContain('8453')
    expect(msg1).toContain('inv_001')
  })

  it('should include all fields in the message', () => {
    const params = {
      chainId: 8453,
      assetAddress: '0xasset',
      amount: '500',
      seller: '0xseller',
      invoiceId: 'inv_002',
      expiresAt: '2030-06-01T00:00:00Z',
      nonce: 'abc123',
    }
    const msg = buildSignedMessage(params)
    const parts = msg.split('|')
    expect(parts).toHaveLength(8) // x402|chainId|asset|amount|seller|invoiceId|expiresAt|nonce
  })
})

describe('computeSignatureHash', () => {
  it('should produce consistent SHA-256 hash', () => {
    const sig = '0xdeadbeef'
    const h1 = computeSignatureHash(sig)
    const h2 = computeSignatureHash(sig)
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(64) // hex SHA-256
  })

  it('should produce different hashes for different signatures', () => {
    expect(computeSignatureHash('0xabc')).not.toBe(computeSignatureHash('0xdef'))
  })
})

describe('computePayloadHash', () => {
  it('should hash a payload deterministically', () => {
    const p = { version: 'x402/v1', nonce: 'abc' }
    expect(computePayloadHash(p)).toBe(computePayloadHash(p))
  })
})
