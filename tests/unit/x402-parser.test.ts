import { describe, it, expect } from 'vitest'
import { parseVerifyRequest } from '../../src/protocol/x402-parser.js'

const VALID_REQUEST = {
  version: '1',
  scheme: 'exact',
  network: 'base-mainnet',
  asset: 'USDC',
  invoiceId: 'inv_test_001',
  requiredAmount: '1000000',
  recipient: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  payload: {
    signature: '0x' + 'a'.repeat(130),
    authorization: {
      from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      to:   '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      value: '1000000',
      validAfter:  0,
      validBefore: Math.floor(Date.now() / 1000) + 300,
      nonce: '0x' + '1'.repeat(64),
    },
  },
}

describe('parseVerifyRequest', () => {
  it('accepts a valid request', () => {
    const result = parseVerifyRequest(VALID_REQUEST)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.version).toBe('1')
      expect(result.data.scheme).toBe('exact')
    }
  })

  it('rejects missing version', () => {
    const r = parseVerifyRequest({ ...VALID_REQUEST, version: undefined })
    expect(r.success).toBe(false)
  })

  it('rejects wrong version', () => {
    const r = parseVerifyRequest({ ...VALID_REQUEST, version: '2' })
    expect(r.success).toBe(false)
  })

  it('rejects invalid from address', () => {
    const r = parseVerifyRequest({
      ...VALID_REQUEST,
      payload: {
        ...VALID_REQUEST.payload,
        authorization: { ...VALID_REQUEST.payload.authorization, from: 'not-an-address' },
      },
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.issues.some((i) => i.path.includes('from'))).toBe(true)
  })

  it('rejects invalid nonce format', () => {
    const r = parseVerifyRequest({
      ...VALID_REQUEST,
      payload: {
        ...VALID_REQUEST.payload,
        authorization: { ...VALID_REQUEST.payload.authorization, nonce: '0x1234' },
      },
    })
    expect(r.success).toBe(false)
  })

  it('rejects invalid signature format', () => {
    const r = parseVerifyRequest({
      ...VALID_REQUEST,
      payload: { ...VALID_REQUEST.payload, signature: '0xabcd' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects non-decimal value', () => {
    const r = parseVerifyRequest({
      ...VALID_REQUEST,
      payload: {
        ...VALID_REQUEST.payload,
        authorization: { ...VALID_REQUEST.payload.authorization, value: '1.5' },
      },
    })
    expect(r.success).toBe(false)
  })
})
