/**
 * Unit tests — NetworkRegistry
 *
 * Tests the registry in isolation using a mock DB.
 * No real PostgreSQL connection required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB module
vi.mock('../../src/infrastructure/db.js', () => ({
  db: {
    network: {
      findMany: vi.fn(),
    },
  },
}))

import { db } from '../../src/infrastructure/db.js'
import { networkRegistry } from '../../src/infrastructure/network-registry.js'

const mockNetworks = [
  {
    id: 'net_1',
    chainId: 8453,
    name: 'base-mainnet',
    rpcUrl: 'https://mainnet.base.org',
    fallbackRpcUrl: 'https://base.drpc.org',
    nativeCurrency: 'ETH',
    blockExplorer: 'https://basescan.org',
    active: true,
    addedBy: 'seed',
    createdAt: new Date(),
    updatedAt: new Date(),
    assets: [
      {
        id: 'asset_1',
        networkId: 'net_1',
        symbol: 'USDC',
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6,
        minAmount: '1',
        maxAmount: '1000000000000',
        active: true,
        createdAt: new Date(),
      },
    ],
  },
]

describe('NetworkRegistry', () => {
  beforeEach(() => {
    vi.mocked(db.network.findMany).mockResolvedValue(mockNetworks as any)
  })

  it('loads networks from PostgreSQL', async () => {
    await networkRegistry.load()
    expect(networkRegistry.getAll()).toHaveLength(1)
    expect(networkRegistry.getAll()[0]?.name).toBe('base-mainnet')
  })

  it('isNetworkSupported returns true for known chainId', async () => {
    await networkRegistry.load()
    expect(networkRegistry.isNetworkSupported(8453)).toBe(true)
  })

  it('isNetworkSupported returns false for unknown chainId', async () => {
    await networkRegistry.load()
    expect(networkRegistry.isNetworkSupported(1)).toBe(false)
  })

  it('isAssetSupported returns true for USDC on base-mainnet', async () => {
    await networkRegistry.load()
    expect(networkRegistry.isAssetSupported(8453, 'USDC')).toBe(true)
  })

  it('isAssetSupported is case-insensitive', async () => {
    await networkRegistry.load()
    expect(networkRegistry.isAssetSupported(8453, 'usdc')).toBe(true)
  })

  it('isAssetSupported returns false for unknown asset', async () => {
    await networkRegistry.load()
    expect(networkRegistry.isAssetSupported(8453, 'DAI')).toBe(false)
  })

  it('getAsset returns asset details', async () => {
    await networkRegistry.load()
    const asset = networkRegistry.getAsset(8453, 'USDC')
    expect(asset?.address).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
    expect(asset?.decimals).toBe(6)
  })

  it('getNetwork returns undefined for unknown chainId', async () => {
    await networkRegistry.load()
    expect(networkRegistry.getNetwork(1)).toBeUndefined()
  })

  it('sets loadedAt on successful load', async () => {
    await networkRegistry.load()
    expect(networkRegistry.loadedAt).toBeInstanceOf(Date)
  })

  it('keeps previous state if reload fails', async () => {
    await networkRegistry.load()
    vi.mocked(db.network.findMany).mockRejectedValueOnce(new Error('PG down'))
    // Simulate the auto-reload try/catch
    try { await networkRegistry.load() } catch {}
    // Previous state preserved
    expect(networkRegistry.getAll()).toHaveLength(1)
  })
})
