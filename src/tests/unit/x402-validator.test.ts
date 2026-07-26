import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateExpiration, validateNetworkAndAsset, validateAmount } from '../../protocol/x402-validator.js'
import { FacilitatorError } from '../../http/errors.js'

// Mock config
vi.mock('../../infrastructure/config.js', () => ({
  config: {
    SUPPORTED_CHAIN_ID: 8453,
    SUPPORTED_ASSET_ADDRESS: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    CLOCK_SKEW_TOLERANCE_SECONDS: 30,
    PLATFORM_FEE_BPS: 50,
    DEVELOPER_SHARE_PERCENT: 20,
  },
}))

describe('validateNetworkAndAsset', () => {
  it('should pass for supported network and asset', () => {
    expect(() =>
      validateNetworkAndAsset({
        version: 'x402/v1',
        network: { chainId: 8453 },
        asset: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
        amount: '1000',
        seller: '0xseller',
        buyer: '0xbuyer',
        invoiceId: 'inv_001',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        nonce: 'n1',
        signature: '0xsig',
        scheme: 'erc20-transfer',
      }),
    ).not.toThrow()
  })

  it('should throw unsupported_network for wrong chainId', () => {
    expect(() =>
      validateNetworkAndAsset({
        version: 'x402/v1',
        network: { chainId: 1 }, // Ethereum mainnet, not Base
        asset: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
        amount: '1000',
        seller: '0xseller',
        buyer: '0xbuyer',
        invoiceId: 'inv_001',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        nonce: 'n1',
        signature: '0xsig',
        scheme: 'erc20-transfer',
      }),
    ).toThrow(FacilitatorError)
  })
})

describe('validateExpiration', () => {
  it('should pass for a future expiration', () => {
    const future = new Date(Date.now() + 60000).toISOString()
    expect(() => validateExpiration(future)).not.toThrow()
  })

  it('should throw expired_payment for a past expiration', () => {
    const past = new Date(Date.now() - 60000).toISOString()
    expect(() => validateExpiration(past)).toThrow(FacilitatorError)
  })

  it('should allow within clock skew tolerance', () => {
    // 10 seconds ago, within the 30s tolerance
    const slightlyPast = new Date(Date.now() - 10000).toISOString()
    expect(() => validateExpiration(slightlyPast)).not.toThrow()
  })
})

describe('validateAmount', () => {
  it('should pass for a positive amount', () => {
    expect(() => validateAmount('1000000')).not.toThrow()
  })

  it('should throw invalid_amount for zero', () => {
    expect(() => validateAmount('0')).toThrow(FacilitatorError)
  })
})
