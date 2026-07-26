/**
 * Sellers & Webhooks routes — fully persisted to PostgreSQL.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { generateApiKey, generateSellerId, generateWebhookId, generateWebhookSecret } from '../../infrastructure/api-key.js'
import { hashApiKey, verifyApiKey } from '../../infrastructure/api-key.js'
import { db } from '../../infrastructure/db.js'
import { logger } from '../../infrastructure/logger.js'

const RegisterSellerBody = z.object({
  name: z.string().min(1).max(100),
  referralCode: z.string().max(50).optional(),
  deviceType: z.enum(['server', 'robot', 'iot', 'agent']).default('server'),
  webhookUrl: z.string().url().optional(),
})

const CreateWebhookBody = z.object({
  url: z.string().url(),
  events: z.array(
    z.enum(['settlement.confirmed', 'settlement.failed', 'verify.accepted', 'verify.rejected'])
  ).min(1),
})

/** Extract bearer token from Authorization header */
function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

/** Resolve seller from API key — PostgreSQL lookup */
async function resolveSeller(authHeader?: string) {
  const token = extractBearerToken(authHeader)
  if (!token) return null
  const sellers = await db.seller.findMany({ where: { active: true } })
  return sellers.find((s) => verifyApiKey(token, s.apiKeyHash)) ?? null
}

export async function registerSellersRoutes(app: FastifyInstance): Promise<void> {

  // ── Registration ─────────────────────────────────────────────────────────

  app.post('/sellers/register', {
    schema: {
      tags: ['sellers'],
      summary: 'Register a seller and receive an API key',
      description: [
        'Register a new seller identity (server, robot, IoT, AI agent).',
        '**The API key is shown only once.** Store it securely.',
        'Persisted to PostgreSQL.',
      ].join('\n'),
      body: {
        type: 'object', required: ['name'],
        properties: {
          name: { type: 'string', example: 'Home Robot v2' },
          referralCode: { type: 'string' },
          deviceType: { type: 'string', enum: ['server', 'robot', 'iot', 'agent'], default: 'server' },
          webhookUrl: { type: 'string', format: 'uri' },
        },
      },
    },
  }, async (request, reply) => {
    const body = RegisterSellerBody.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ code: 'invalid_payload', reason: 'Validation failed', message: body.error.errors[0]?.message })
    }

    const { raw: apiKey, hash: apiKeyHash } = generateApiKey()
    const sellerId = generateSellerId()

    // Custodial wallet: in production, generate via viem generatePrivateKey + privateKeyToAccount
    const walletAddress = `0x${Buffer.from(sellerId).toString('hex').slice(0, 40)}`

    const seller = await db.seller.create({
      data: {
        id: sellerId,
        name: body.data.name,
        apiKeyHash,
        walletAddress,
        referralCode: body.data.referralCode,
        deviceType: body.data.deviceType as 'server' | 'robot' | 'iot' | 'agent',
        webhookUrl: body.data.webhookUrl,
      },
    })

    logger.info({ sellerId, deviceType: seller.deviceType }, 'seller registered')

    return reply.status(201).send({
      sellerId: seller.id,
      apiKey, // one-time
      walletAddress: seller.walletAddress,
      deviceType: seller.deviceType,
      createdAt: seller.createdAt.toISOString(),
    })
  })

  // ── Webhooks ─────────────────────────────────────────────────────────────

  app.post('/webhooks', {
    schema: {
      tags: ['webhooks'],
      summary: 'Subscribe to payment events',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['url', 'events'],
        properties: {
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string', enum: ['settlement.confirmed', 'settlement.failed', 'verify.accepted', 'verify.rejected'] } },
        },
      },
    },
  }, async (request, reply) => {
    const seller = await resolveSeller(request.headers.authorization)
    if (!seller) return reply.status(401).send({ code: 'unauthorized', reason: 'Invalid API key', message: 'Provide Authorization: Bearer <apiKey>' })

    const body = CreateWebhookBody.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ code: 'invalid_payload', reason: 'Validation failed', message: body.error.errors[0]?.message })
    }

    const webhookId = generateWebhookId()
    const secret = generateWebhookSecret()

    const webhook = await db.webhookSubscription.create({
      data: {
        id: webhookId,
        sellerId: seller.id,
        url: body.data.url,
        events: body.data.events,
        secret,
      },
    })

    logger.info({ webhookId, sellerId: seller.id, events: body.data.events }, 'webhook created')

    return reply.status(201).send({
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      active: webhook.active,
      secret, // one-time
      createdAt: webhook.createdAt.toISOString(),
    })
  })

  app.get('/webhooks', {
    schema: { tags: ['webhooks'], summary: 'List webhook subscriptions', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const seller = await resolveSeller(request.headers.authorization)
    if (!seller) return reply.status(401).send({ code: 'unauthorized', reason: 'Invalid API key', message: '' })

    const webhooks = await db.webhookSubscription.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, url: true, events: true, active: true, createdAt: true },
    })

    return reply.send(webhooks)
  })

  app.delete('/webhooks/:id', {
    schema: { tags: ['webhooks'], summary: 'Delete a webhook subscription', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const seller = await resolveSeller(request.headers.authorization)
    if (!seller) return reply.status(401).send({ code: 'unauthorized', reason: 'Invalid API key', message: '' })

    const { id } = request.params as { id: string }
    await db.webhookSubscription.deleteMany({ where: { id, sellerId: seller.id } })
    return reply.status(204).send()
  })
}
