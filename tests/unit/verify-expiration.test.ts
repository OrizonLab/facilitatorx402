/**
 * Unit tests — expiration logic in verify service
 */
import { describe, it, expect, vi } from 'vitest'

// We test the expiration logic directly via parseX402Payload — validBefore is in the past
import { parseX402Payload } from '../../src/protocol/x402-parser.js'

describe('x402 expiration field validation', () => {
  const base = {
    version: '1',
    scheme: 'exact',
    network: 'base-mainnet',
    asset: 'USDC',
    invoiceId: 'inv_exp_01',
    requiredAmount: '1000000',
    recipient: '0x1234567890123456789012345678901234567890',
    payload: {
      signature: '0x' + 'ab'.repeat(65),
      authorization: {
        from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        to: '0x1234567890123456789012345678901234567890',
        value: '1000000',
        validAfter: 0,
        validBefore: Math.floor(Date.now() / 1000) + 3600, // future
        nonce: '0x' + 'cc'.repeat(16),
      },
    },
  }

  it('accepts payload with future validBefore', () => {
    expect(parseX402Payload(base).success).toBe(true)
  })

  it('rejects payload where validBefore is 0 (already expired)', () => {
    const expired = {
      ...base,
      payload: {
        ...base.payload,
        authorization: { ...base.payload.authorization, validBefore: 0 },
      },
    }
    // validBefore: 0 fails Zod positive() check
    const result = parseX402Payload(expired)
    expect(result.success).toBe(false)
  })

  it('accepts payload with validAfter = 0 (no hold)', () => {
    expect(parseX402Payload(base).success).toBe(true)
  })
})
