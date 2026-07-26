/**
 * Tests — Middleware auth seller
 *
 * Tests :
 *   1. Injecte request.seller si X-Api-Key valide
 *   2. 401 missing_api_key si header absent
 *   3. 401 missing_api_key si header vide
 *   4. 401 invalid_api_key si clé inconnue
 *   5. 401 invalid_api_key si seller inactif
 *   6. 500 internal_error si DB erreur
 *   7. optionalSellerAuth — passe sans seller si pas de X-Api-Key
 *   8. optionalSellerAuth — injecte le seller si X-Api-Key valide
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../application/seller.service.js', () => ({
  getSellerByApiKey: vi.fn(),
}))

import { getSellerByApiKey } from '../../application/seller.service.js'
import { requireSellerAuth, optionalSellerAuth } from '../middleware/auth.js'

const ACTIVE_SELLER = {
  id: 'seller_001',
  name: 'Test Seller',
  walletAddress: '0xAbc',
  active: true,
}

function makeRequest(apiKey?: string) {
  return {
    headers: apiKey !== undefined ? { 'x-api-key': apiKey } : {},
    url: '/test',
    seller: undefined,
  } as any
}

function makeReply() {
  let statusCode = 200
  let body: unknown = null
  return {
    status: vi.fn((code: number) => {
      statusCode = code
      return { send: vi.fn((b: unknown) => { body = b }) }
    }),
    _status: () => statusCode,
    _body: () => body,
  } as any
}

describe('requireSellerAuth', () => {
  beforeEach(() => vi.clearAllMocks())

  it('injecte request.seller si X-Api-Key valide et seller actif', async () => {
    ;(getSellerByApiKey as any).mockResolvedValue(ACTIVE_SELLER)
    const request = makeRequest('sk_live_valid_key')
    const reply = makeReply()
    await requireSellerAuth(request, reply)

    expect(request.seller).toBeDefined()
    expect(request.seller!.id).toBe('seller_001')
    expect(reply.status).not.toHaveBeenCalled()
  })

  it('retourne 401 missing_api_key si header absent', async () => {
    const request = makeRequest(undefined)
    const reply = makeReply()
    await requireSellerAuth(request, reply)

    expect(reply.status).toHaveBeenCalledWith(401)
    expect(getSellerByApiKey).not.toHaveBeenCalled()
  })

  it('retourne 401 missing_api_key si header vide', async () => {
    const request = makeRequest('')
    const reply = makeReply()
    await requireSellerAuth(request, reply)

    expect(reply.status).toHaveBeenCalledWith(401)
    expect(getSellerByApiKey).not.toHaveBeenCalled()
  })

  it('retourne 401 invalid_api_key si seller introuvable', async () => {
    ;(getSellerByApiKey as any).mockResolvedValue(null)
    const request = makeRequest('sk_live_unknown')
    const reply = makeReply()
    await requireSellerAuth(request, reply)

    expect(reply.status).toHaveBeenCalledWith(401)
  })

  it('retourne 401 invalid_api_key si seller inactif', async () => {
    ;(getSellerByApiKey as any).mockResolvedValue({ ...ACTIVE_SELLER, active: false })
    const request = makeRequest('sk_live_inactive')
    const reply = makeReply()
    await requireSellerAuth(request, reply)

    expect(reply.status).toHaveBeenCalledWith(401)
  })

  it('retourne 500 internal_error si DB lève une erreur', async () => {
    ;(getSellerByApiKey as any).mockRejectedValue(new Error('DB down'))
    const request = makeRequest('sk_live_key')
    const reply = makeReply()
    await requireSellerAuth(request, reply)

    expect(reply.status).toHaveBeenCalledWith(500)
  })
})

describe('optionalSellerAuth', () => {
  beforeEach(() => vi.clearAllMocks())

  it('est noop si X-Api-Key absent — request.seller reste undefined', async () => {
    const request = makeRequest(undefined)
    const reply = makeReply()
    await optionalSellerAuth(request, reply)

    expect(request.seller).toBeUndefined()
    expect(getSellerByApiKey).not.toHaveBeenCalled()
  })

  it('injecte le seller si X-Api-Key valide', async () => {
    ;(getSellerByApiKey as any).mockResolvedValue(ACTIVE_SELLER)
    const request = makeRequest('sk_live_valid')
    const reply = makeReply()
    await optionalSellerAuth(request, reply)

    expect(request.seller?.id).toBe('seller_001')
  })

  it('fail silently si DB erreur — request.seller reste undefined', async () => {
    ;(getSellerByApiKey as any).mockRejectedValue(new Error('DB down'))
    const request = makeRequest('sk_live_key')
    const reply = makeReply()
    await optionalSellerAuth(request, reply)

    expect(request.seller).toBeUndefined()
    expect(reply.status).not.toHaveBeenCalled()
  })
})
