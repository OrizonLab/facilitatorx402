/**
 * Seller management routes
 *
 * POST /sellers
 *     Créer un nouveau seller.
 *     Body : { name, apiKey, walletAddress, webhookUrl?, referralCode?, deviceType? }
 *     Returns : seller public profile (sans apiKey)
 *
 * POST /sellers/:sellerId/webhooks
 *     Enregistrer ou mettre à jour la subscription webhook d'un seller.
 *     Body : { url, secret, events }
 *     Auth : X-Api-Key header
 *
 * GET /sellers/:sellerId
 *     Profil public du seller.
 *     Auth : X-Api-Key header
 *
 * Ces routes sont destinées à l'onboarding et à la configuration.
 * Elles NE sont PAS exposées publiquement — protéger derrière un reverse proxy
 * ou ajouter un ADMIN_TOKEN séparé selon votre modèle de déploiement.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sellerService } from '../../application/seller.service.js'

const CreateSellerSchema = z.object({
  name: z.string().min(1).max(100),
  apiKey: z.string().min(16),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  referralCode: z.string().max(50).optional(),
  webhookUrl: z.string().url().optional(),
  deviceType: z.enum(['server', 'robot', 'iot', 'agent']).optional(),
})

const RegisterWebhookSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(16),
  events: z.array(
    z.enum(['payment.verified', 'payment.settled', 'payment.failed'])
  ).min(1),
})

export async function sellerRoutes(app: FastifyInstance) {

  // POST /sellers — create seller
  app.post('/sellers', async (request, reply) => {
    const body = CreateSellerSchema.parse(request.body)
    const seller = await sellerService.create(body)
    return reply.status(201).send(seller)
  })

  // GET /sellers/:sellerId — get seller profile
  app.get('/sellers/:sellerId', async (request, reply) => {
    const { sellerId } = request.params as { sellerId: string }
    const apiKey = (request.headers['x-api-key'] as string) ?? ''
    const caller = await sellerService.getByApiKey(apiKey)
    if (!caller || caller.id !== sellerId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
    return reply.send(caller)
  })

  // POST /sellers/:sellerId/webhooks — register webhook
  app.post('/sellers/:sellerId/webhooks', async (request, reply) => {
    const { sellerId } = request.params as { sellerId: string }
    const apiKey = (request.headers['x-api-key'] as string) ?? ''
    const caller = await sellerService.getByApiKey(apiKey)
    if (!caller || caller.id !== sellerId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
    const body = RegisterWebhookSchema.parse(request.body)
    await sellerService.registerWebhook(sellerId, body.url, body.secret, body.events)
    return reply.status(200).send({ success: true, message: 'Webhook subscription registered' })
  })
}
