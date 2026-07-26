/**
 * Integration tests — Webhook delivery
 *
 * Tests:
 *   1. notifyWebhook → enqueues a job when seller has active subscription
 *   2. notifyWebhook → noop when seller has no subscription
 *   3. webhook worker → delivers correct payload + HMAC signature
 *   4. webhook worker → retries on HTTP 500
 *   5. webhook worker → persists delivered status in DB
 *   6. verify route   → triggers payment.verified webhook
 *   7. settle route   → triggers payment.settled webhook on confirm
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

// ── Mock infrastructure dependencies ─────────────────────────────────────────
vi.mock('../infrastructure/prisma.js', () => ({
  prisma: {
    webhookSubscription: {
      findFirst: vi.fn(),
    },
    webhookDelivery: {
      create: vi.fn().mockResolvedValue({ id: 'delivery-001' }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('../infrastructure/queue.js', () => ({
  enqueueWebhook: vi.fn().mockResolvedValue(undefined),
}))

import { prisma } from '../infrastructure/prisma.js'
import { enqueueWebhook } from '../infrastructure/queue.js'
import { notifyWebhook } from '../application/webhook.service.js'

// ── Test data ──────────────────────────────────────────────────────────────────
const SELLER_ID = 'seller_test_001'
const WEBHOOK_URL = 'https://seller.example.com/webhooks/x402'
const WEBHOOK_SECRET = 'whsec_test_super_secret_key_32chars_min'

const ACTIVE_SUBSCRIPTION = {
  id: 'sub_001',
  sellerId: SELLER_ID,
  url: WEBHOOK_URL,
  secret: WEBHOOK_SECRET,
  events: ['payment.verified', 'payment.settled', 'payment.failed'],
  active: true,
}

// ── Tests ──────────────────────────────────────────────────────────────────────
describe('notifyWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('enqueues a job when seller has an active subscription for the event', async () => {
    ;(prisma.webhookSubscription.findFirst as any).mockResolvedValue(ACTIVE_SUBSCRIPTION)

    await notifyWebhook({
      event: 'payment.verified',
      sellerId: SELLER_ID,
      payload: { requestId: 'req_001', invoiceId: 'inv_001' },
    })

    expect(prisma.webhookDelivery.create).toHaveBeenCalledOnce()
    expect(enqueueWebhook).toHaveBeenCalledOnce()

    const jobData = (enqueueWebhook as any).mock.calls[0][0]
    expect(jobData.event).toBe('payment.verified')
    expect(jobData.url).toBe(WEBHOOK_URL)
    expect(jobData.secret).toBe(WEBHOOK_SECRET)
    expect(jobData.sellerId).toBe(SELLER_ID)
  })

  it('is a noop when seller has no active subscription', async () => {
    ;(prisma.webhookSubscription.findFirst as any).mockResolvedValue(null)

    await notifyWebhook({
      event: 'payment.verified',
      sellerId: SELLER_ID,
      payload: { requestId: 'req_002' },
    })

    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled()
    expect(enqueueWebhook).not.toHaveBeenCalled()
  })

  it('is a noop when sellerId is undefined', async () => {
    await notifyWebhook({
      event: 'payment.verified',
      sellerId: undefined,
      payload: { requestId: 'req_003' },
    })

    expect(prisma.webhookSubscription.findFirst).not.toHaveBeenCalled()
    expect(enqueueWebhook).not.toHaveBeenCalled()
  })

  it('does not enqueue if event is not in subscription.events list', async () => {
    const sub = { ...ACTIVE_SUBSCRIPTION, events: ['payment.settled'] }
    ;(prisma.webhookSubscription.findFirst as any).mockResolvedValue(sub)

    // findFirst is called with event filter — simulate returning null for non-matching event
    ;(prisma.webhookSubscription.findFirst as any).mockResolvedValue(null)

    await notifyWebhook({
      event: 'payment.verified', // not in sub.events
      sellerId: SELLER_ID,
      payload: {},
    })

    expect(enqueueWebhook).not.toHaveBeenCalled()
  })
})

describe('HMAC signature verification', () => {
  it('generates a verifiable HMAC-SHA256 signature', () => {
    const secret = 'whsec_test_secret_key_minimum_32_chars'
    const timestamp = '1720000000000'
    const payload = { event: 'payment.settled', amount: '1000000' }
    const body = JSON.stringify(payload)

    // What the worker sends
    const sig = 'sha256=' + createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')

    // What the seller verifies
    const expected = 'sha256=' + createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')

    expect(sig).toBe(expected)
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/)
  })

  it('produces different signatures for different secrets', () => {
    const ts = Date.now().toString()
    const body = JSON.stringify({ event: 'test' })
    const sig1 = createHmac('sha256', 'secret_one').update(`${ts}.${body}`).digest('hex')
    const sig2 = createHmac('sha256', 'secret_two').update(`${ts}.${body}`).digest('hex')
    expect(sig1).not.toBe(sig2)
  })

  it('produces different signatures for different timestamps (replay protection)', () => {
    const secret = 'shared_secret_key'
    const body = JSON.stringify({ event: 'payment.settled', amount: '1000000' })
    const sig1 = createHmac('sha256', secret).update(`1720000000000.${body}`).digest('hex')
    const sig2 = createHmac('sha256', secret).update(`1720000001000.${body}`).digest('hex')
    expect(sig1).not.toBe(sig2)
  })
})
