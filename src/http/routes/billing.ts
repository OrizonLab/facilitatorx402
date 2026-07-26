/**
 * Billing routes — Phase 8
 *
 * GET /billing/referral/:code   — Stats d'un referral code (opérateur)
 * GET /billing/seller/:address  — Volume mensuel + fees d'un seller
 *
 * Auth: X-Admin-Api-Key header (same as /admin/* routes).
 * Keep this endpoint behind a firewall / VPN in production.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getReferralStats, getMonthlyVolumeForSeller } from '../../settlement/referral-service.js'
import type { PrismaClient } from '@prisma/client'
import { getConfig } from '../../infrastructure/config.js'
import { logger } from '../../infrastructure/logger.js'

const ReferralParams = z.object({ code: z.string().min(1).max(64) })
const SellerParams   = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) })
const MonthQuery     = z.object({
  year:  z.coerce.number().int().min(2024).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})

/**
 * Reusable admin auth hook — identical pattern to admin.route.ts.
 * Validates X-Admin-Api-Key header on every request under this plugin.
 */
function billingAuthHook(app: FastifyInstance): void {
  app.addHook('preHandler', async (request, reply) => {
    const config = getConfig()
    const key = request.headers['x-admin-api-key']
    if (!config.ADMIN_API_KEY || key !== config.ADMIN_API_KEY) {
      logger.warn(
        { ip: request.ip, path: request.url },
        'billing: unauthorized access attempt',
      )
      return reply.status(401).send({
        error: {
          code:    'unauthorized',
          reason:  'Invalid or missing admin API key',
          message: 'Provide X-Admin-Api-Key header',
        },
      })
    }
  })
}

export async function registerBillingRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
): Promise<void> {
  // Protect all /billing/* routes with admin API key
  billingAuthHook(app)

  /**
   * GET /billing/referral/:code
   * Returns cumulative stats for a referral code.
   */
  app.get<{ Params: { code: string } }>(
    '/billing/referral/:code',
    {
      schema: {
        tags: ['operator'],
        summary: '[Billing] Referral code stats',
        security: [{ adminKey: [] }],
        params: {
          type: 'object',
          properties: { code: { type: 'string', example: 'PARTNER_XYZ' } },
        },
      },
    },
    async (req, reply) => {
      const { code } = ReferralParams.parse(req.params)
      const stats = await getReferralStats(prisma, code)
      return reply.send({
        referralCode:        stats.referralCode,
        totalSettlements:    stats.totalSettlements,
        totalGrossVolume:    stats.totalGrossVolume.toString(),
        totalPlatformFee:    stats.totalPlatformFee.toString(),
        totalDeveloperShare: stats.totalDeveloperShare.toString(),
        firstUsedAt:         stats.firstUsedAt?.toISOString() ?? null,
        lastUsedAt:          stats.lastUsedAt?.toISOString()  ?? null,
      })
    },
  )

  /**
   * GET /billing/seller/:address?year=2026&month=7
   * Returns monthly settled volume for a seller address.
   */
  app.get<{ Params: { address: string }; Querystring: { year?: string; month?: string } }>(
    '/billing/seller/:address',
    {
      schema: {
        tags: ['operator'],
        summary: '[Billing] Monthly seller volume',
        security: [{ adminKey: [] }],
        params: {
          type: 'object',
          properties: { address: { type: 'string', example: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' } },
        },
        querystring: {
          type: 'object',
          properties: {
            year:  { type: 'integer', example: 2026 },
            month: { type: 'integer', example: 7 },
          },
        },
      },
    },
    async (req, reply) => {
      const { address }     = SellerParams.parse(req.params)
      const { year, month } = MonthQuery.parse(req.query)
      const now = new Date()
      const y   = year  ?? now.getFullYear()
      const m   = month ?? (now.getMonth() + 1)

      const volume = await getMonthlyVolumeForSeller(prisma, address, y, m)

      return reply.send({
        seller:             address,
        year:               y,
        month:              m,
        monthlyVolumeUnits: volume.toString(),
        monthlyVolumeUsdc:  (Number(volume) / 1_000_000).toFixed(6),
      })
    },
  )
}
