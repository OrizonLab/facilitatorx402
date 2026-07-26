/**
 * SellerService — Application layer
 *
 * Gestion des sellers : création, lookup par apiKey, activation/désactivation.
 *
 * La table `sellers` stocke :
 *   - apiKeyHash  : hash SHA-256 de l'API key (jamais la clé en clair)
 *   - walletAddress : adresse wallet du seller (destinataire des paiements)
 *   - webhookUrl  : URL de webhook (optionnel, géré via WebhookSubscription)
 *   - referralCode : code de parrainage pour le fee engine
 *   - deviceType  : server | robot | iot | agent
 *
 * Sécurité :
 *   - Les API keys ne sont jamais stockées en clair
 *   - hashApiKey() utilise SHA-256 (Node.js crypto, pas de lib externe)
 *   - getByApiKey() accepte la clé raw et hash à la volée
 *
 * @example
 *   const seller = await sellerService.getByApiKey('x402_sk_live_xxx')
 *   if (!seller) throw new Error('Unauthorized')
 */
import crypto from 'node:crypto'
import { prisma } from '../infrastructure/prisma.js'
import { logger } from '../infrastructure/logger.js'

export interface CreateSellerInput {
  name: string
  apiKey: string          // raw key — will be hashed before storage
  walletAddress: string
  referralCode?: string
  webhookUrl?: string
  deviceType?: 'server' | 'robot' | 'iot' | 'agent'
}

export interface SellerPublic {
  id: string
  name: string
  walletAddress: string
  referralCode: string | null
  webhookUrl: string | null
  deviceType: string
  active: boolean
  createdAt: Date
}

function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex')
}

export class SellerService {
  /**
   * Create a new seller.
   * The raw API key is hashed before storage.
   */
  async create(input: CreateSellerInput): Promise<SellerPublic> {
    const apiKeyHash = hashApiKey(input.apiKey)

    const seller = await prisma.seller.create({
      data: {
        name: input.name,
        apiKeyHash,
        walletAddress: input.walletAddress.toLowerCase(),
        referralCode: input.referralCode ?? null,
        webhookUrl: input.webhookUrl ?? null,
        deviceType: input.deviceType ?? 'server',
      },
    })

    logger.info({ sellerId: seller.id, name: seller.name }, 'seller created')
    return this.toPublic(seller)
  }

  /**
   * Look up a seller by their raw API key.
   * Returns null if not found or inactive.
   */
  async getByApiKey(rawKey: string): Promise<SellerPublic | null> {
    const hash = hashApiKey(rawKey)
    const seller = await prisma.seller.findUnique({ where: { apiKeyHash: hash } })
    if (!seller || !seller.active) return null
    return this.toPublic(seller)
  }

  /**
   * Get a seller by ID.
   */
  async getById(id: string): Promise<SellerPublic | null> {
    const seller = await prisma.seller.findUnique({ where: { id } })
    if (!seller) return null
    return this.toPublic(seller)
  }

  /**
   * Register or update a webhook subscription for a seller.
   *
   * @param sellerId   - Seller ID
   * @param url        - HTTPS URL to deliver events to
   * @param secret     - HMAC secret for signature verification
   * @param events     - List of events to subscribe to
   */
  async registerWebhook(
    sellerId: string,
    url: string,
    secret: string,
    events: string[]
  ): Promise<void> {
    await prisma.webhookSubscription.upsert({
      where: {
        // Use sellerId + url as upsert key via unique index
        id: `wh_${sellerId}`, // simplified for V2 (one subscription per seller)
      },
      update: { url, secret, events, active: true },
      create: { sellerId, url, secret, events, active: true },
    })
    logger.info({ sellerId, url, events }, 'webhook subscription registered')
  }

  private toPublic(s: any): SellerPublic {
    return {
      id: s.id,
      name: s.name,
      walletAddress: s.walletAddress,
      referralCode: s.referralCode ?? null,
      webhookUrl: s.webhookUrl ?? null,
      deviceType: s.deviceType,
      active: s.active,
      createdAt: s.createdAt,
    }
  }
}

export const sellerService = new SellerService()
