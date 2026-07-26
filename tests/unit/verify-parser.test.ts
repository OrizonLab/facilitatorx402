/**
 * Unit tests — x402 payload parser
 */
import { describe, it, expect } from 'vitest'
import { parseX402Payload } from '../../src/protocol/x402-parser.js'

const validPayload = {
  version: '1',
  scheme: 'exact',
  network: 'base-mainnet',
  asset: 'USDC',
  invoiceId: 'inv_01',
  requiredAmount: '1000000',
  recipient: '0x1234567890123456789012345678901234567890',
  payload: {
    signature: '0x' + 'ab'.repeat(65),
    authorization: {
      from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      to: '0x1234567890123456789012345678901234567890',
      value: '1000000',
      validAfter: 0,
      validBefore: Math.floor(Date.now() / 1000) + 3600,
      nonce: '0x' + 'cc'.repeat(16),
    },
  },
}

describe('parseX402Payload', () => {
  it('accepts a valid payload', () => {
    const result = parseX402Payload(validPayload)
    expect(result.success).toBe(true)
  })

  it('upcases asset symbol', () => {
    const result = parseX402Payload({ ...validPayload, asset: 'usdc' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.asset).toBe('USDC')
  })

  it('rejects missing version', () => {
    const { version: _, ...rest } = validPayload
    const result = parseX402Payload(rest)
    expect(result.success).toBe(false)
  })

  it('rejects version !== 1', () => {
    const result = parseX402Payload({ ...validPayload, version: '2' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid Ethereum address', () => {
    const result = parseX402Payload({
      ...validPayload,
      recipient: 'not-an-address',
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-decimal value', () => {
    const result = parseX402Payload({
      ...validPayload,
      payload: {
        ...validPayload.payload,
        authorization: { ...validPayload.payload.authorization, value: '0x1000' },
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects short signature', () => {
    const result = parseX402Payload({
      ...validPayload,
      payload: { ...validPayload.payload, signature: '0xdeadbeef' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative validAfter', () => {
    const result = parseX402Payload({
      ...validPayload,
      payload: {
        ...validPayload.payload,
        authorization: { ...validPayload.payload.authorization, validAfter: -1 },
      },
    })
    expect(result.success).toBe(false)
  })
})
