/**
 * Sellers & Webhooks routes — fully persisted to PostgreSQL.
 *
 * Security:
 *   - Webhook URLs validated via assertSafeWebhookUrl (SSRF guard)
 *   - Webhook signing secrets encrypted at rest with AES-256-GCM
 *     (encryptWebhookSecret / decryptWebhookSecret)
 *   - API key comparisons use verifyApiKey (bcrypt) — timing-safe by design
 *   - POST /sellers/rotate-key: rotate API key without losing seller record
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { generateApiKey, generateSellerId, generateWebhookId, generateWebhookSecret } from '../../infrastructure/api-key.js'
import { hashApiKey, verifyApiKey } from '../../infrastructure/api-key.js'
import { assertSafeWebhookUrl } from '../../infrastructure/webhook-dispatcher.js'
import { encryptWebhookSecret, decryptWebhookSecret } from '../../infrastructure/webhook-secret.js'
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

function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

async function resolveSeller(authHeader?: string) {
  const token = extractBearerToken(authHeader)
  if (!token) return null
  const sellers = await db.seller.findMany({ where: { active: true } })
  return sellers.find((s) => verifyApiKey(token, s.apiKeyHash)) ?? null
}

export async function registerSellersRoutes(app: FastifyInstance): Promise<void> {

  // ── Registration ──────────────────────────────────────────────────────────

  app.post('/sellers/register', {
    schema: {
      tags: ['sellers'],
      summary: 'Register a seller and receive an API key',
      description: 'Register a new seller. **The API key is shown only once.** Store it securely.',
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

    if (body.data.webhookUrl) {
      try { await assertSafeWebhookUrl(body.data.webhookUrl) }
      catch (err: any) {
        return reply.status(400).send({ code: 'invalid_webhook_url', reason: 'Webhook URL failed security validation', message: err.message })
      }
    }

    const { raw: apiKey, hash: apiKeyHash } = generateApiKey()
    const sellerId = generateSellerId()
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
      apiKey,
      walletAddress: seller.walletAddress,
      deviceType: seller.deviceType,
      createdAt: seller.createdAt.toISOString(),
    })
  })

  // ── API Key Rotation ──────────────────────────────────────────────────────

  app.post('/sellers/rotate-key', {
    schema: {
      tags: ['sellers'],
      summary: 'Rotate the API key for the authenticated seller',
      description: 'Invalidates the current API key and issues a new one. **New key shown only once.**',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const seller = await resolveSeller(request.headers.authorization)
    if (!seller) {
      return reply.status(401).send({ code: 'unauthorized', reason: 'Invalid API key', message: 'Provide Authorization: Bearer <currentApiKey>' })
    }

    const { raw: newApiKey, hash: newApiKeyHash } = generateApiKey()
    await db.seller.update({ where: { id: seller.id }, data: { apiKeyHash: newApiKeyHash } })
    logger.info({ sellerId: seller.id }, 'seller API key rotated')

    return reply.status(200).send({ sellerId: seller.id, apiKey: newApiKey, rotatedAt: new Date().toISOString() })
  })

  // ── Webhooks ──────────────────────────────────────────────────────────────

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
    if (!seller) return reply.status(401).send({ code: 'unauthorized', reason: 'Invalid API key', message: '' })

    const body = CreateWebhookBody.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ code: 'invalid_payload', reason: 'Validation failed', message: body.error.errors[0]?.message })
    }

    try { await assertSafeWebhookUrl(body.data.url) }
    catch (err: any) {
      return reply.status(400).send({ code: 'invalid_webhook_url', reason: 'Webhook URL failed security validation', message: err.message })
    }

    const webhookId = generateWebhookId()
    const plaintextSecret = generateWebhookSecret()
    // Encrypt the secret before persisting — DB never stores plaintext
    const encryptedSecret = encryptWebhookSecret(plaintextSecret)

    const webhook = await db.webhookSubscription.create({
      data: {
        id: webhookId,
        sellerId: seller.id,
        url: body.data.url,
        events: body.data.events,
        secret: encryptedSecret,
      },
    })

    logger.info({ webhookId, sellerId: seller.id, events: body.data.events }, 'webhook created')

    return reply.status(201).send({
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      active: webhook.active,
      secret: plaintextSecret, // one-time: plaintext returned to caller, encrypted in DB
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
      // secret intentionally excluded from list response
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
