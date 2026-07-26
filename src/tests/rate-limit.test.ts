/**
 * Tests — Rate limiting par seller
 *
 * Tests :
 *   1. Passe si sous la limite
 *   2. Bloque avec 429 si dépassé
 *   3. Retourne les headers X-RateLimit-*
 *   4. Fail open si Redis indisponible (ne bloque pas le trafic)
 *   5. Noop si pas de X-Api-Key (rate limit IP s'applique)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../infrastructure/redis.js', () => ({
  redis: {
    incr: vi.fn(),
    expire: vi.fn().mockResolvedValue(1),
  },
}))

vi.mock('../infrastructure/config.js', () => ({
  getConfig: () => ({
    RATE_LIMIT_SELLER_VERIFY: 60,
    RATE_LIMIT_SELLER_SETTLE: 30,
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX: 100,
  }),
}))

vi.mock('prom-client', () => ({
  Counter: vi.fn().mockImplementation(() => ({ inc: vi.fn() })),
  register: { registerMetric: vi.fn() },
}))

import { redis } from '../infrastructure/redis.js'
import { createSellerRateLimitHook } from '../infrastructure/rate-limit.js'

function makeMockReply() {
  const headers: Record<string, string | number> = {}
  let statusCode = 200
  let body: unknown = null
  return {
    header: vi.fn((k: string, v: string | number) => { headers[k] = v }),
    status: vi.fn((code: number) => { statusCode = code; return { send: vi.fn((b: unknown) => { body = b }) } }),
    _headers: headers,
    _status: () => statusCode,
    _body: () => body,
    send: vi.fn((b: unknown) => { body = b }),
  }
}

function makeMockRequest(apiKey?: string) {
  return {
    headers: apiKey ? { 'x-api-key': apiKey } : {},
    url: '/verify',
    routerPath: '/verify',
  } as any
}

describe('createSellerRateLimitHook', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passe si le compteur est sous la limite', async () => {
    ;(redis.incr as any).mockResolvedValue(1) // première requête
    const hook = createSellerRateLimitHook('verify')
    const reply = makeMockReply()
    await hook(makeMockRequest('sk_test_key'), reply as any)

    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Limit', 60)
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Remaining', 59)
    expect(reply.status).not.toHaveBeenCalled() // pas de 429
  })

  it('bloque avec 429 si le compteur dépasse la limite', async () => {
    ;(redis.incr as any).mockResolvedValue(61) // 61 > limite 60
    const hook = createSellerRateLimitHook('verify')
    const reply = makeMockReply()
    await hook(makeMockRequest('sk_test_key'), reply as any)

    expect(reply.status).toHaveBeenCalledWith(429)
  })

  it('retourne remaining = 0 quand exactement à la limite', async () => {
    ;(redis.incr as any).mockResolvedValue(60) // exactement à la limite
    const hook = createSellerRateLimitHook('verify')
    const reply = makeMockReply()
    await hook(makeMockRequest('sk_test_key'), reply as any)

    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Remaining', 0)
    expect(reply.status).not.toHaveBeenCalled() // 60/60 = ok, pas bloqué
  })

  it('est noop si pas de X-Api-Key', async () => {
    const hook = createSellerRateLimitHook('verify')
    const reply = makeMockReply()
    await hook(makeMockRequest(undefined), reply as any)

    expect(redis.incr).not.toHaveBeenCalled()
    expect(reply.status).not.toHaveBeenCalled()
  })

  it('fail open si Redis lève une erreur', async () => {
    ;(redis.incr as any).mockRejectedValue(new Error('Redis down'))
    const hook = createSellerRateLimitHook('verify')
    const reply = makeMockReply()
    await hook(makeMockRequest('sk_test_key'), reply as any)

    // Doit passer sans bloquer malgré l'erreur Redis
    expect(reply.status).not.toHaveBeenCalled()
  })

  it('applique la limite settle (30) différente de verify (60)', async () => {
    ;(redis.incr as any).mockResolvedValue(31) // 31 > limite settle 30
    const hook = createSellerRateLimitHook('settle')
    const reply = makeMockReply()
    await hook(makeMockRequest('sk_test_key'), reply as any)

    expect(reply.status).toHaveBeenCalledWith(429)
  })
})
