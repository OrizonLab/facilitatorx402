/**
 * Fee calculator — ADR-002
 * Platform fee in basis points + developer share.
 * All amounts in asset units (BigInt).
 */

export interface FeeConfig {
  platformFeeBps: number   // e.g. 50 = 0.5%
  developerSharePercent: number  // e.g. 20 = 20% of platform fee
}

export interface FeeResult {
  feeAmount: bigint        // Platform fee taken
  developerShare: bigint   // Portion of fee for referral developer
  netAmount: bigint        // amount - feeAmount (what seller receives)
}

/**
 * Compute fees for a settled payment.
 * Uses floor rounding to avoid fractional units.
 */
export function calculateFees(
  amount: bigint,
  config: FeeConfig,
  hasReferral: boolean,
): FeeResult {
  const feeAmount = (amount * BigInt(config.platformFeeBps)) / BigInt(10_000)
  const developerShare = hasReferral
    ? (feeAmount * BigInt(config.developerSharePercent)) / BigInt(100)
    : BigInt(0)
  const netAmount = amount - feeAmount

  return { feeAmount, developerShare, netAmount }
}

/**
 * Load fee config from environment variables with defaults.
 */
export function loadFeeConfig(): FeeConfig {
  return {
    platformFeeBps: parseInt(process.env.PLATFORM_FEE_BPS ?? '50', 10),
    developerSharePercent: parseInt(process.env.DEVELOPER_SHARE_PERCENT ?? '20', 10),
  }
}
