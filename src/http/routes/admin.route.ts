/**
 * Admin API — dynamic network & asset management
 *
 * Allows adding/updating/disabling networks and assets without restart.
 * The NetworkRegistry auto-reloads from DB every 60s.
 *
 * All admin endpoints require the ADMIN_API_KEY header.
 * Keep this endpoint behind a firewall / VPN in production.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ulid } from 'ulid'
import { db } from '../../infrastructure/db.js'
import { getConfig } from '../../infrastructure/config.js'
import { logger } from '../../infrastructure/logger.js'

const AddNetworkBody = z.object({
  chainId: z.number().int().positive(),
  name: z.string().min(1).max(64),
  rpcUrl: z.string().url(),
  fallbackRpcUrl: z.string().url().optional(),
  nativeCurrency: z.string().default('ETH'),
  blockExplorer: z.string().url(),
  active: z.boolean().default(true),
})

const AddAssetBody = z.object({
  symbol: z.string().min(1).max(20),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  decimals: z.number().int().min(0).max(18).default(6),
  minAmount: z.string().default('1'),
  maxAmount: z.string().default('1000000000'),
  active: z.boolean().default(true),
})

function adminAuthHook(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const config = getConfig()
    const key = request.headers['x-admin-api-key']
    if (!config.ADMIN_API_KEY || key !== config.ADMIN_API_KEY) {
      return reply.status(401).send({
        code: 'unauthorized',
        reason: 'Invalid or missing admin API key',
        message: 'Provide X-Admin-Api-Key header',
      })
    }
  })
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // Protect all /admin/* routes
  adminAuthHook(app)

  // ── Networks ─────────────────────────────────────────────────────────────

  /**
   * GET /admin/networks
   * List all networks (active and inactive).
   */
  app.get('/admin/networks', {
    schema: {
      tags: ['operator'],
      summary: '[Admin] List all networks',
      security: [{ adminKey: [] }],
    },
  }, async (_req, reply) => {
    const networks = await db.network.findMany({
      orderBy: { createdAt: 'asc' },
      include: { assets: true },
    })
    return reply.send(networks)
  })

  /**
   * POST /admin/networks
   * Add a new EVM network. No restart required.
   */
  app.post('/admin/networks', {
    schema: {
      tags: ['operator'],
      summary: '[Admin] Add a network',
      description: 'Add an EVM-compatible network. Takes effect within 60s (registry auto-reload).',
      security: [{ adminKey: [] }],
      body: {
        type: 'object',
        required: ['chainId', 'name', 'rpcUrl', 'blockExplorer'],
        properties: {
          chainId: { type: 'integer', example: 8453 },
          name: { type: 'string', example: 'base-mainnet' },
          rpcUrl: { type: 'string', format: 'uri', example: 'https://mainnet.base.org' },
          fallbackRpcUrl: { type: 'string', format: 'uri' },
          nativeCurrency: { type: 'string', default: 'ETH' },
          blockExplorer: { type: 'string', format: 'uri' },
          active: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    const body = AddNetworkBody.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ code: 'invalid_payload', reason: 'Validation failed', message: body.error.errors[0]?.message })
    }

    const existing = await db.network.findUnique({ where: { chainId: body.data.chainId } })
    if (existing) {
      return reply.status(409).send({ code: 'duplicate_network', reason: 'Network already exists', message: `chainId ${body.data.chainId} already registered` })
    }

    const network = await db.network.create({
      data: { id: ulid(), ...body.data, addedBy: 'admin' },
    })

    logger.info({ chainId: body.data.chainId, name: body.data.name }, 'network added via admin API')
    return reply.status(201).send(network)
  })

  /**
   * PUT /admin/networks/:chainId
   * Update a network (rpcUrl, active status, fallback RPC).
   */
  app.put('/admin/networks/:chainId', {
    schema: {
      tags: ['operator'],
      summary: '[Admin] Update a network',
      params: { type: 'object', properties: { chainId: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const { chainId } = request.params as { chainId: number }
    const body = AddNetworkBody.partial().safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ code: 'invalid_payload', reason: 'Validation failed', message: body.error.errors[0]?.message })
    }

    const network = await db.network.update({
      where: { chainId: Number(chainId) },
      data: body.data,
    }).catch(() => null)

    if (!network) return reply.status(404).send({ code: 'not_found', reason: 'Network not found', message: `chainId ${chainId} not found` })

    logger.info({ chainId, updates: body.data }, 'network updated via admin API')
    return reply.send(network)
  })

  /**
   * DELETE /admin/networks/:chainId
   * Soft-disable a network (sets active=false, no data loss).
   */
  app.delete('/admin/networks/:chainId', {
    schema: {
      tags: ['operator'],
      summary: '[Admin] Disable a network (soft delete)',
      params: { type: 'object', properties: { chainId: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const { chainId } = request.params as { chainId: number }
    await db.network.update({
      where: { chainId: Number(chainId) },
      data: { active: false },
    }).catch(() => null)
    logger.info({ chainId }, 'network disabled via admin API')
    return reply.status(204).send()
  })

  // ── Assets ───────────────────────────────────────────────────────────────

  /**
   * POST /admin/networks/:chainId/assets
   * Add an ERC-20 asset to a network.
   */
  app.post('/admin/networks/:chainId/assets', {
    schema: {
      tags: ['operator'],
      summary: '[Admin] Add an asset to a network',
      description: 'Register an ERC-20 token. Supports USDC, USDT, DAI, and any ERC-20.',
      params: { type: 'object', properties: { chainId: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const { chainId } = request.params as { chainId: number }
    const body = AddAssetBody.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ code: 'invalid_payload', reason: 'Validation failed', message: body.error.errors[0]?.message })
    }

    const network = await db.network.findUnique({ where: { chainId: Number(chainId) } })
    if (!network) return reply.status(404).send({ code: 'not_found', reason: 'Network not found', message: `chainId ${chainId} not found` })

    const asset = await db.networkAsset.create({
      data: { id: ulid(), networkId: network.id, ...body.data },
    }).catch(() => null)

    if (!asset) return reply.status(409).send({ code: 'duplicate_asset', reason: 'Asset already registered on this network', message: `${body.data.symbol} already exists on chainId ${chainId}` })

    logger.info({ chainId, symbol: body.data.symbol, address: body.data.address }, 'asset added via admin API')
    return reply.status(201).send(asset)
  })

  /**
   * DELETE /admin/networks/:chainId/assets/:symbol
   * Soft-disable an asset.
   */
  app.delete('/admin/networks/:chainId/assets/:symbol', {
    schema: {
      tags: ['operator'],
      summary: '[Admin] Disable an asset (soft delete)',
      params: { type: 'object', properties: { chainId: { type: 'integer' }, symbol: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { chainId, symbol } = request.params as { chainId: number; symbol: string }
    const network = await db.network.findUnique({ where: { chainId: Number(chainId) } })
    if (!network) return reply.status(404).send({ code: 'not_found', reason: 'Network not found', message: '' })

    await db.networkAsset.updateMany({
      where: { networkId: network.id, symbol: symbol.toUpperCase() },
      data: { active: false },
    })
    return reply.status(204).send()
  })

  // ── Sellers ──────────────────────────────────────────────────────────────

  app.get('/admin/sellers', {
    schema: { tags: ['operator'], summary: '[Admin] List all sellers' },
  }, async (_req, reply) => {
    const sellers = await db.seller.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, deviceType: true, walletAddress: true, active: true, createdAt: true },
    })
    return reply.send(sellers)
  })

  app.delete('/admin/sellers/:id', {
    schema: { tags: ['operator'], summary: '[Admin] Deactivate a seller' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await db.seller.update({ where: { id }, data: { active: false } }).catch(() => null)
    return reply.status(204).send()
  })
}
