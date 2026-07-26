/**
 * Middleware auth seller — X-Api-Key.
 *
 * Vérifie le header X-Api-Key, lookup le seller en DB via hash SHA-256.
 * Injecte le seller dans request.seller pour les handlers en aval.
 *
 * Usage :
 *   import { requireSellerAuth } from '../middleware/auth.js'
 *
 *   app.post('/sellers/:id/webhooks', {
 *     preHandler: [requireSellerAuth],
 *   }, handler)
 *
 * Le seller est accessible dans le handler :
 *   const seller = request.seller
 *
 * Codes d'erreur :
 *   401 missing_api_key    — header absent
 *   401 invalid_api_key    — clé inconnue ou seller inactif
 */
import type { FastifyRequest, FastifyReply } from 'fastify'
import { getSellerByApiKey } from '../../application/seller.service.js'
import { logger } from '../../infrastructure/logger.js'

// Augmentation du type FastifyRequest pour TypeScript
declare module 'fastify' {
  interface FastifyRequest {
    seller?: {
      id: string
      name: string
      walletAddress: string
      active: boolean
    }
  }
}

export async function requireSellerAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string | undefined

  if (!apiKey || apiKey.trim() === '') {
    return reply.status(401).send({
      error: {
        code: 'missing_api_key',
        reason: 'Authentication required',
        message: 'X-Api-Key header is required for this endpoint.',
      },
    })
  }

  try {
    const seller = await getSellerByApiKey(apiKey)

    if (!seller || !seller.active) {
      logger.warn({ endpoint: request.url }, 'invalid or inactive seller API key attempt')
      return reply.status(401).send({
        error: {
          code: 'invalid_api_key',
          reason: 'Authentication failed',
          message: 'Invalid API key or inactive seller account.',
        },
      })
    }

    request.seller = {
      id: seller.id,
      name: seller.name,
      walletAddress: seller.walletAddress,
      active: seller.active,
    }
  } catch (err) {
    logger.error({ err }, 'auth middleware internal error')
    return reply.status(500).send({
      error: {
        code: 'internal_error',
        message: 'Authentication service error. Please retry.',
      },
    })
  }
}

/**
 * Middleware optionnel — injecte le seller si X-Api-Key présent, sans bloquer.
 * Utile pour les endpoints qui fonctionnent avec ou sans auth.
 */
export async function optionalSellerAuth(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string | undefined
  if (!apiKey) return

  try {
    const seller = await getSellerByApiKey(apiKey)
    if (seller?.active) {
      request.seller = {
        id: seller.id,
        name: seller.name,
        walletAddress: seller.walletAddress,
        active: seller.active,
      }
    }
  } catch {
    // fail silently pour optionalAuth
  }
}
