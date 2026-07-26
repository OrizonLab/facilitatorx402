/**
 * GET /supported
 *
 * Returns all active networks, assets, schemes, extensions, and limits
 * dynamically from PostgreSQL via NetworkRegistry (cached, reloads every 60s).
 *
 * Response is stable and versioned — never changes shape between releases.
 * Consumers (sellers) can poll this endpoint to discover configuration.
 */
import type { FastifyInstance } from 'fastify'
import { networkRegistry } from '../../infrastructure/network-registry.js'

const X402_VERSIONS = ['1'] as const
const X402_SCHEMES = ['exact'] as const
const X402_EXTENSIONS = ['receipts', 'referral', 'fee_engine'] as const

export async function registerSupportedRoute(app: FastifyInstance): Promise<void> {
  app.get('/supported', {
    schema: {
      tags: ['operator'],
      summary: 'Get supported networks, assets, schemes and limits',
      description: [
        'Returns the full configuration of this facilitator instance.',
        'Data is served from an in-memory registry loaded from PostgreSQL.',
        'Refreshed every 60 seconds — no DB query on this hot path.',
        '',
        '**Sellers should call this endpoint on startup** to verify their',
        'network/asset pair is active before submitting payments.',
      ].join('\n'),
      response: {
        200: {
          type: 'object',
          properties: {
            versions: { type: 'array', items: { type: 'string' } },
            networks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  chainId: { type: 'integer' },
                  name: { type: 'string' },
                  nativeCurrency: { type: 'string' },
                  blockExplorer: { type: 'string' },
                  assets: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        symbol: { type: 'string' },
                        address: { type: 'string' },
                        decimals: { type: 'integer' },
                        limits: {
                          type: 'object',
                          properties: {
                            minAmount: { type: 'string' },
                            maxAmount: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            schemes: { type: 'array', items: { type: 'string' } },
            extensions: { type: 'array', items: { type: 'string' } },
            settlementOptions: {
              type: 'object',
              properties: {
                idempotent: { type: 'boolean' },
                receiptAvailable: { type: 'boolean' },
                confirmations: { type: 'integer' },
                feeEngine: { type: 'boolean' },
              },
            },
            registryLoadedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const networks = networkRegistry.getAll()

    const networksPayload = networks.map((n) => ({
      chainId: n.chainId,
      name: n.name,
      nativeCurrency: n.nativeCurrency,
      blockExplorer: n.blockExplorer,
      assets: n.assets.map((a) => ({
        symbol: a.symbol,
        address: a.address,
        decimals: a.decimals,
        limits: {
          minAmount: a.minAmount,
          maxAmount: a.maxAmount,
        },
      })),
    }))

    return reply.send({
      versions: [...X402_VERSIONS],
      networks: networksPayload,
      schemes: [...X402_SCHEMES],
      extensions: [...X402_EXTENSIONS],
      settlementOptions: {
        idempotent: true,
        receiptAvailable: true,
        confirmations: 1,
        feeEngine: true,
      },
      registryLoadedAt: networkRegistry.loadedAt?.toISOString() ?? null,
    })
  })
}
