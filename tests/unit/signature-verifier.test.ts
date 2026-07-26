import { describe, it, expect } from 'vitest'
import { computeSignatureHash } from '../../src/crypto/signature-verifier.js'

describe('computeSignatureHash', () => {
  it('returns lowercase hex of the signature', () => {
    const sig = '0x' + 'A'.repeat(130)
    const hash = computeSignatureHash(sig)
    expect(hash).toBe(sig.toLowerCase())
  })

  it('is deterministic for the same input', () => {
    const sig = '0x' + 'f'.repeat(130)
    expect(computeSignatureHash(sig)).toBe(computeSignatureHash(sig))
  })

  it('returns different hashes for different signatures', () => {
    const sig1 = '0x' + 'a'.repeat(130)
    const sig2 = '0x' + 'b'.repeat(130)
    expect(computeSignatureHash(sig1)).not.toBe(computeSignatureHash(sig2))
  })
})
