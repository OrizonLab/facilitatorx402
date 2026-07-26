/**
 * Integration tests — GET /supported
 *
 * Uses a real Fastify instance with mocked NetworkRegistry.
 * No real PostgreSQL or Redis required for this test.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import Fastify from 'fastify'
import { registerSupportedRoute } from '../../src/http/routes/supported.route.js'

vi.mock('../../src/infrastructure/network-registry.js', () => ({
  networkRegistry: {
    getAll: vi.fn().mockReturnValue([
      {
        chainId: 8453,
        name: 'base-mainnet',
        nativeCurrency: 'ETH',
        blockExplorer: 'https://basescan.org',
        assets: [
          {
            symbol: 'USDC',
            address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            decimals: 6,
            minAmount: '1',
            maxAmount: '1000000000000',
          },
        ],
      },
    ]),
    loadedAt: new Date('2026-07-26T00:00:00Z'),
  },
}))

describe('GET /supported', () => {
  const app = Fastify()

  beforeAll(async () => {
    await app.register(registerSupportedRoute)
    await app.ready()
  })

  it('returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/supported' })
    expect(res.statusCode).toBe(200)
  })

  it('includes x402 version', async () => {
    const res = await app.inject({ method: 'GET', url: '/supported' })
    const body = res.json()
    expect(body.versions).toContain('1')
  })

  it('includes base-mainnet with USDC', async () => {
    const res = await app.inject({ method: 'GET', url: '/supported' })
    const body = res.json()
    expect(body.networks).toHaveLength(1)
    expect(body.networks[0].chainId).toBe(8453)
    expect(body.networks[0].assets[0].symbol).toBe('USDC')
  })

  it('includes settlement options', async () => {
    const res = await app.inject({ method: 'GET', url: '/supported' })
    const body = res.json()
    expect(body.settlementOptions.idempotent).toBe(true)
    expect(body.settlementOptions.receiptAvailable).toBe(true)
  })

  it('includes registryLoadedAt timestamp', async () => {
    const res = await app.inject({ method: 'GET', url: '/supported' })
    const body = res.json()
    expect(body.registryLoadedAt).toBe('2026-07-26T00:00:00.000Z')
  })

  it('response shape is stable', async () => {
    const res = await app.inject({ method: 'GET', url: '/supported' })
    const body = res.json()
    expect(body).toHaveProperty('versions')
    expect(body).toHaveProperty('networks')
    expect(body).toHaveProperty('schemes')
    expect(body).toHaveProperty('extensions')
    expect(body).toHaveProperty('settlementOptions')
    expect(body).toHaveProperty('registryLoadedAt')
  })
})
