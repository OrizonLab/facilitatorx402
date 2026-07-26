/**
 * Referral Service — Phase 8
 *
 * Tracks referral code usage and computes cumulative developer share.
 * Provides analytics per referral code for partner onboarding.
 */
import type { PrismaClient } from '@prisma/client'

export interface ReferralStats {
  referralCode:          string
  totalSettlements:      number
  totalGrossVolume:      bigint
  totalPlatformFee:      bigint
  totalDeveloperShare:   bigint
  firstUsedAt:           Date | null
  lastUsedAt:            Date | null
}

export async function getReferralStats(
  prisma: PrismaClient,
  referralCode: string,
): Promise<ReferralStats> {
  const settlements = await prisma.paymentSettlement.findMany({
    where: {
      referralCode,
      settlementStatus: 'confirmed',
    },
    include: { request: true },
    orderBy: { createdAt: 'asc' },
  })

  const totalGrossVolume    = settlements.reduce((acc, s) => acc + BigInt(s.request?.amount ?? '0'), 0n)
  const totalPlatformFee    = settlements.reduce((acc, s) => acc + BigInt(s.feeAmount ?? '0'), 0n)
  const totalDeveloperShare = settlements.reduce((acc, s) => acc + BigInt(s.developerShare ?? '0'), 0n)

  return {
    referralCode,
    totalSettlements:    settlements.length,
    totalGrossVolume,
    totalPlatformFee,
    totalDeveloperShare,
    firstUsedAt: settlements[0]?.createdAt ?? null,
    lastUsedAt:  settlements[settlements.length - 1]?.createdAt ?? null,
  }
}

export async function getMonthlyVolumeForSeller(
  prisma: PrismaClient,
  seller: string,
  year:   number,
  month:  number,  // 1-12
): Promise<bigint> {
  const from = new Date(year, month - 1, 1)
  const to   = new Date(year, month,     1)

  const settlements = await prisma.paymentSettlement.findMany({
    where: {
      settlementStatus: 'confirmed',
      createdAt: { gte: from, lt: to },
      request: { seller },
    },
    include: { request: true },
  })

  return settlements.reduce((acc, s) => acc + BigInt(s.request?.amount ?? '0'), 0n)
}
