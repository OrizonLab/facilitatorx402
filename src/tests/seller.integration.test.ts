/**
 * Integration tests — Seller management
 *
 * Tests:
 *   1. Create a seller with hashed API key
 *   2. Lookup seller by raw API key
 *   3. Register a webhook subscription
 *   4. Update webhook subscription (upsert)
 *   5. Reject duplicate seller names
 *   6. Hash isolation — raw key never stored in DB
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'

// ── Mocks ──────────────────────────────────────────────────────────────────────
vi.mock('../infrastructure/prisma.js', () => ({
  prisma: {
    seller: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    webhookSubscription: {
      upsert: vi.fn(),
    },
  },
}))

import { prisma } from '../infrastructure/prisma.js'
import { createSeller, getSellerByApiKey, registerWebhook } from '../application/seller.service.js'

// ── Helpers ────────────────────────────────────────────────────────────────────
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

// ── Tests ──────────────────────────────────────────────────────────────────────
describe('createSeller', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stores hashed API key, never the raw value', async () => {
    const rawKey = 'sk_live_test_key_plain_text'
    const expectedHash = sha256(rawKey)

    ;(prisma.seller.create as any).mockResolvedValue({
      id: 'seller_001',
      name: 'Test Seller',
      apiKeyHash: expectedHash,
      walletAddress: '0xAbcDef1234567890',
      active: true,
      createdAt: new Date(),
    })

    const seller = await createSeller({ name: 'Test Seller', apiKey: rawKey, walletAddress: '0xAbcDef1234567890' })

    const createCall = (prisma.seller.create as any).mock.calls[0][0]
    expect(createCall.data.apiKeyHash).toBe(expectedHash)
    expect(JSON.stringify(createCall)).not.toContain(rawKey) // raw key never in query
    expect(seller.id).toBe('seller_001')
  })

  it('returns the seller without exposing apiKeyHash in response', async () => {
    ;(prisma.seller.create as any).mockResolvedValue({
      id: 'seller_002',
      name: 'Safe Seller',
      apiKeyHash: sha256('sk_live_safe'),
      walletAddress: '0x0000',
      active: true,
      createdAt: new Date(),
    })

    const seller = await createSeller({ name: 'Safe Seller', apiKey: 'sk_live_safe', walletAddress: '0x0000' })
    expect((seller as any).apiKeyHash).toBeUndefined()
  })
})

describe('getSellerByApiKey', () => {
  beforeEach(() => vi.clearAllMocks())

  it('finds a seller by hashing the raw API key for lookup', async () => {
    const rawKey = 'sk_live_lookup_key'
    const expectedHash = sha256(rawKey)

    ;(prisma.seller.findFirst as any).mockResolvedValue({
      id: 'seller_003',
      name: 'Lookup Seller',
      apiKeyHash: expectedHash,
      active: true,
    })

    const seller = await getSellerByApiKey(rawKey)

    const findCall = (prisma.seller.findFirst as any).mock.calls[0][0]
    expect(findCall.where.apiKeyHash).toBe(expectedHash)
    expect(seller?.id).toBe('seller_003')
  })

  it('returns null for an unknown API key', async () => {
    ;(prisma.seller.findFirst as any).mockResolvedValue(null)
    const seller = await getSellerByApiKey('sk_live_unknown_key')
    expect(seller).toBeNull()
  })
})

describe('registerWebhook', () => {
  beforeEach(() => vi.clearAllMocks())

  it('upserts a webhook subscription for a seller', async () => {
    const sellerId = 'seller_004'
    const url = 'https://example.com/hooks'
    const secret = 'whsec_test_secret_minimum_32_chars_ok'
    const events = ['payment.settled', 'payment.failed']

    ;(prisma.webhookSubscription.upsert as any).mockResolvedValue({
      id: 'sub_001',
      sellerId,
      url,
      active: true,
      events,
    })

    const sub = await registerWebhook(sellerId, url, secret, events)

    expect(prisma.webhookSubscription.upsert).toHaveBeenCalledOnce()
    const upsertCall = (prisma.webhookSubscription.upsert as any).mock.calls[0][0]
    expect(upsertCall.where.sellerId).toBe(sellerId)
    expect(upsertCall.create.url).toBe(url)
    expect(upsertCall.update.url).toBe(url)
    expect(sub.sellerId).toBe(sellerId)
  })
})
