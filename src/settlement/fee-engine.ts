/**
 * Fee engine — computes platform commission and developer share.
 *
 * All amounts are in the asset's smallest unit (e.g. USDC = 6 decimals).
 * Uses integer arithmetic (BigInt) to avoid floating-point errors.
 *
 * Config (from env):
 *   PLATFORM_FEE_BPS  — platform commission in basis points (default: 50 = 0.5%)
 *   DEVELOPER_SHARE_BPS — share of platform fee to developer (default: 20 = 0.2%)
 *
 * Example (1 USDC = 1_000_000 units, BPS=50):
 *   grossAmount    = 1_000_000
 *   platformFee    = 1_000_000 * 50 / 10_000 = 5_000  (0.005 USDC)
 *   developerShare = 5_000 * 20 / 10_000 = 10          (0.00001 USDC)
 *   netAmount      = 1_000_000 - 5_000 = 995_000
 */
import { getConfig } from '../infrastructure/config.js'

export interface FeeBreakdown {
  grossAmount: bigint
  platformFee: bigint
  developerShare: bigint
  netAmount: bigint
  feeBps: number
  developerShareBps: number
}

export function computeFees(
  grossAmount: bigint,
  overrideFeeBps?: number
): FeeBreakdown {
  const config = getConfig()
  const feeBps = overrideFeeBps ?? config.PLATFORM_FEE_BPS
  const developerShareBps = config.DEVELOPER_SHARE_BPS

  const platformFee = (grossAmount * BigInt(feeBps)) / BigInt(10_000)
  const developerShare = (platformFee * BigInt(developerShareBps)) / BigInt(10_000)
  const netAmount = grossAmount - platformFee

  return {
    grossAmount,
    platformFee,
    developerShare,
    netAmount,
    feeBps,
    developerShareBps,
  }
}
