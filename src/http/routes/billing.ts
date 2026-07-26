/**
 * Billing routes — Phase 8
 *
 * GET /billing/referral/:code   — Stats d'un referral code (opérateur)
 * GET /billing/seller/:address  — Volume mensuel + fees d'un seller
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getReferralStats, getMonthlyVolumeForSeller } from '../../settlement/referral-service.js'
import type { PrismaClient } from '@prisma/client'

const ReferralParams = z.object({ code: z.string().min(1).max(64) })
const SellerParams   = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) })
const MonthQuery     = z.object({
  year:  z.coerce.number().int().min(2024).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})

export async function registerBillingRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
): Promise<void> {
  // GET /billing/referral/:code
  app.get<{ Params: { code: string } }>(
    '/billing/referral/:code',
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

  // GET /billing/seller/:address?year=2026&month=7
  app.get<{ Params: { address: string }; Querystring: { year?: string; month?: string } }>(
    '/billing/seller/:address',
    async (req, reply) => {
      const { address }    = SellerParams.parse(req.params)
      const { year, month } = MonthQuery.parse(req.query)
      const now = new Date()
      const y   = year  ?? now.getFullYear()
      const m   = month ?? (now.getMonth() + 1)

      const volume = await getMonthlyVolumeForSeller(prisma, address, y, m)

      return reply.send({
        seller:              address,
        year:                y,
        month:               m,
        monthlyVolumeUnits:  volume.toString(),
        monthlyVolumeUsdc:   (Number(volume) / 1_000_000).toFixed(6),
      })
    },
  )
}
