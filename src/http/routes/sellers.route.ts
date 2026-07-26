import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ulid } from 'ulid'
import { generateApiKey, generateSellerId, generateWebhookId, generateWebhookSecret } from '../../infrastructure/api-key.js'
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

export async function registerSellersRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /sellers/register
   * Register a new seller (server, robot, IoT device, AI agent).
   * Returns a one-time API key — store it securely.
   */
  app.post('/sellers/register', {
    schema: {
      tags: ['sellers'],
      summary: 'Register a seller and receive an API key',
      description: [
        'Register a new seller identity. Returns a one-time API key.',
        '',
        'The `deviceType` field helps the facilitator optimize rate limits and observability:',
        '- `server`: Traditional backend service',
        '- `robot`: Autonomous physical device (domestic robot, industrial arm)',
        '- `iot`: IoT sensor or embedded device',
        '- `agent`: AI agent or LLM-based autonomous software',
        '',
        '**⚠️ The API key is shown only once. Store it securely.**',
      ].join('\n'),
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100, example: 'Home Robot v2' },
          referralCode: { type: 'string', example: 'PARTNER_XYZ' },
          deviceType: { type: 'string', enum: ['server', 'robot', 'iot', 'agent'], default: 'server' },
          webhookUrl: { type: 'string', format: 'uri', example: 'https://my-service.example.com/x402/events' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            sellerId: { type: 'string', example: 'sel_01J3XKZP000000000000000000' },
            apiKey: { type: 'string', example: 'fx402_live_abc123...' },
            walletAddress: { type: 'string', example: '0xabc...' },
            deviceType: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        400: { $ref: 'ErrorResponse' },
      },
    },
  }, async (request, reply) => {
    const body = RegisterSellerBody.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({
        code: 'invalid_payload',
        reason: 'Validation failed',
        message: body.error.errors[0]?.message ?? 'Invalid request body',
      })
    }

    const { raw: apiKey, hash: apiKeyHash } = generateApiKey()
    const sellerId = generateSellerId()
    // In production: generate a real custodial wallet via viem
    const walletAddress = `0x${crypto.randomBytes(20).toString('hex')}`
    const now = new Date().toISOString()

    // TODO: persist to DB (sellers table)
    logger.info(
      { sellerId, deviceType: body.data.deviceType, referralCode: body.data.referralCode },
      'seller registered'
    )

    return reply.status(201).send({
      sellerId,
      apiKey,  // shown once
      walletAddress,
      deviceType: body.data.deviceType,
      createdAt: now,
    })
  })

  /**
   * POST /webhooks
   * Create a webhook subscription.
   */
  app.post('/webhooks', {
    schema: {
      tags: ['webhooks'],
      summary: 'Subscribe to payment events',
      description: [
        'Create a webhook subscription to receive push notifications for payment events.',
        '',
        'The facilitator sends a signed POST request to your URL when an event occurs.',
        'Verify the `X-Facilitator-Signature` header using HMAC-SHA256 and the returned `secret`.',
        '',
        'Critical for autonomous devices (robots, IoT) that cannot poll for status.',
        '',
        '## Event types',
        '- `settlement.confirmed` — Payment settled on-chain',
        '- `settlement.failed` — Settlement transaction failed',
        '- `verify.accepted` — Payment proof accepted',
        '- `verify.rejected` — Payment proof rejected',
      ].join('\n'),
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['url', 'events'],
        properties: {
          url: { type: 'string', format: 'uri', example: 'https://my-service.example.com/x402/events' },
          events: {
            type: 'array',
            items: { type: 'string', enum: ['settlement.confirmed', 'settlement.failed', 'verify.accepted', 'verify.rejected'] },
            example: ['settlement.confirmed', 'settlement.failed'],
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'wh_01J3XKZP000000000000000000' },
            url: { type: 'string' },
            events: { type: 'array', items: { type: 'string' } },
            active: { type: 'boolean' },
            secret: { type: 'string', example: 'whsec_abc123...' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const body = CreateWebhookBody.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({
        code: 'invalid_payload',
        reason: 'Validation failed',
        message: body.error.errors[0]?.message ?? 'Invalid request body',
      })
    }

    const webhookId = generateWebhookId()
    const secret = generateWebhookSecret()

    // TODO: persist to DB + link to authenticated seller
    logger.info({ webhookId, url: body.data.url, events: body.data.events }, 'webhook created')

    return reply.status(201).send({
      id: webhookId,
      url: body.data.url,
      events: body.data.events,
      active: true,
      secret, // shown once
      createdAt: new Date().toISOString(),
    })
  })

  /**
   * GET /webhooks
   */
  app.get('/webhooks', {
    schema: {
      tags: ['webhooks'],
      summary: 'List webhook subscriptions',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              url: { type: 'string' },
              events: { type: 'array', items: { type: 'string' } },
              active: { type: 'boolean' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  }, async (_request, reply) => {
    // TODO: fetch from DB for authenticated seller
    return reply.send([])
  })

  /**
   * DELETE /webhooks/:id
   */
  app.delete('/webhooks/:id', {
    schema: {
      tags: ['webhooks'],
      summary: 'Delete a webhook subscription',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      response: { 204: { type: 'null' } },
    },
  }, async (_request, reply) => {
    // TODO: delete from DB
    return reply.status(204).send()
  })
}
