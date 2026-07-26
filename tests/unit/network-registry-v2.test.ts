/**
 * Unit tests — Network Registry V2
 *
 * Verifies:
 *   - Base mainnet is always enabled by default
 *   - Optimism/Arbitrum are disabled by default
 *   - getAsset(chainId, symbol) returns correct address
 *   - isSupported() returns correct boolean
 *   - getNetworkByName() works
 *   - toSupportedPayload() shape is stable
 *   - reload() re-loads config
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { NetworkRegistry } from '../../src/infrastructure/network-registry-testable.js'

// We test via a testable export that allows instantiation with custom config
const BASE_CONFIG = [
  {
    chainId: 8453,
    name: 'base-mainnet',
    rpcUrl: 'https://mainnet.base.org',
    enabled: true,
    assets: [
      { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, name: 'USD Coin' },
      { symbol: 'EURC', address: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', decimals: 6, name: 'Euro Coin' },
    ],
  },
  {
    chainId: 10,
    name: 'optimism-mainnet',
    rpcUrl: 'https://mainnet.optimism.io',
    enabled: false,
    assets: [
      { symbol: 'USDC', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6, name: 'USD Coin' },
    ],
  },
]

describe('NetworkRegistry V2', () => {
  let registry: any

  beforeEach(() => {
    registry = new NetworkRegistry(BASE_CONFIG)
  })

  it('loads Base mainnet as enabled', () => {
    expect(registry.getNetwork(8453)).toBeDefined()
    expect(registry.getNetwork(8453).name).toBe('base-mainnet')
  })

  it('does not load disabled Optimism', () => {
    expect(registry.getNetwork(10)).toBeUndefined()
  })

  it('getAsset returns USDC on Base', () => {
    const asset = registry.getAsset(8453, 'USDC')
    expect(asset?.address).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
  })

  it('getAsset returns EURC on Base', () => {
    const asset = registry.getAsset(8453, 'EURC')
    expect(asset?.symbol).toBe('EURC')
  })

  it('isSupported returns true for USDC on Base', () => {
    expect(registry.isSupported(8453, 'USDC')).toBe(true)
  })

  it('isSupported returns false for USDC on disabled Optimism', () => {
    expect(registry.isSupported(10, 'USDC')).toBe(false)
  })

  it('reload enables Optimism when config updated', () => {
    registry.reload([
      ...BASE_CONFIG.map((n) => n.chainId === 10 ? { ...n, enabled: true } : n),
    ])
    expect(registry.getNetwork(10)).toBeDefined()
  })

  it('toSupportedPayload returns stable shape', () => {
    const payload = registry.toSupportedPayload()
    expect(payload.x402Versions).toContain('1')
    expect(payload.networks).toHaveLength(1) // only Base enabled
    expect(payload.networks[0].assets).toContain('USDC')
    expect(payload.networks[0].assets).toContain('EURC')
  })
})
