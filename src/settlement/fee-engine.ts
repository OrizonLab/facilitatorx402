/**
 * Fee Engine — Phase 8
 *
 * Computes platform fees and developer referral share for each settlement.
 *
 * Model (ADR-002 extended):
 *   - Platform fee : configurable in basis points (default 50 bps = 0.5%)
 *   - Developer share : percentage of platform fee reversed to referrer (default 20%)
 *   - Free tier : configurable monthly volume exempted from fees (default 0)
 *   - Premium tier : configurable reduced fee rate per seller
 *
 * All amounts in USDC base units (6 decimals). BigInt arithmetic throughout.
 */

export interface FeeEngineConfig {
  platformFeeBps:    number   // e.g. 50 = 0.5%
  developerShareBps: number   // e.g. 2000 = 20% of platform fee
  freeTierMonthlyUnits: bigint // e.g. 0n or 100_000_000n (100 USDC)
  premiumTiers?: PremiumTier[]
}

export interface PremiumTier {
  sellerAddress:  string
  feeBps:         number   // overrides platformFeeBps for this seller
  expiresAt?:     Date
}

export interface FeeBreakdown {
  grossAmount:      bigint  // original payment amount
  platformFee:      bigint  // fee retained by platform
  developerShare:   bigint  // portion of fee reversed to referrer
  netToSeller:      bigint  // grossAmount - platformFee (+ developerShare stays with platform for now)
  effectiveFeeBps:  number  // actual bps applied
  freeTierApplied:  boolean
  referralCode:     string | null
}

const BPS_DENOMINATOR = 10_000n

export class FeeEngine {
  private readonly cfg: FeeEngineConfig

  constructor(cfg: FeeEngineConfig) {
    this.cfg = cfg
  }

  /**
   * Compute fee breakdown for a settlement.
   *
   * @param grossAmount   Payment amount in USDC base units
   * @param sellerAddress Seller address (for premium tier lookup)
   * @param referralCode  Optional referral code
   * @param monthlyVolumeToDate Already-settled volume this month for this seller (for free tier)
   */
  compute(
    grossAmount:          bigint,
    sellerAddress:        string,
    referralCode:         string | null,
    monthlyVolumeToDate:  bigint = 0n,
  ): FeeBreakdown {
    // 1. Free tier check
    const freeTierApplied = this.cfg.freeTierMonthlyUnits > 0n
      && monthlyVolumeToDate < this.cfg.freeTierMonthlyUnits

    if (freeTierApplied) {
      return {
        grossAmount,
        platformFee:     0n,
        developerShare:  0n,
        netToSeller:     grossAmount,
        effectiveFeeBps: 0,
        freeTierApplied: true,
        referralCode,
      }
    }

    // 2. Resolve effective fee bps (premium tier override if applicable)
    const effectiveFeeBps = this._resolveFeeBps(sellerAddress)

    // 3. Compute platform fee (floor)
    const platformFee = (grossAmount * BigInt(effectiveFeeBps)) / BPS_DENOMINATOR

    // 4. Developer share (percentage of platform fee)
    const developerShare = referralCode
      ? (platformFee * BigInt(this.cfg.developerShareBps)) / BPS_DENOMINATOR
      : 0n

    return {
      grossAmount,
      platformFee,
      developerShare,
      netToSeller:     grossAmount - platformFee,
      effectiveFeeBps,
      freeTierApplied: false,
      referralCode,
    }
  }

  private _resolveFeeBps(sellerAddress: string): number {
    if (!this.cfg.premiumTiers?.length) return this.cfg.platformFeeBps

    const now  = new Date()
    const tier = this.cfg.premiumTiers.find(
      (t) =>
        t.sellerAddress.toLowerCase() === sellerAddress.toLowerCase() &&
        (!t.expiresAt || t.expiresAt > now),
    )

    return tier ? tier.feeBps : this.cfg.platformFeeBps
  }

  /**
   * Format breakdown as a loggable/persistable plain object.
   */
  format(b: FeeBreakdown): Record<string, string | number | boolean | null> {
    return {
      grossAmount:     b.grossAmount.toString(),
      platformFee:     b.platformFee.toString(),
      developerShare:  b.developerShare.toString(),
      netToSeller:     b.netToSeller.toString(),
      effectiveFeeBps: b.effectiveFeeBps,
      freeTierApplied: b.freeTierApplied,
      referralCode:    b.referralCode,
    }
  }
}

/**
 * Factory — build FeeEngine from environment/secrets.
 */
export function createFeeEngine(opts: {
  platformFeeBps:        number
  developerShareBps:     number
  freeTierMonthlyUnits?: bigint
  premiumTiers?:         PremiumTier[]
}): FeeEngine {
  return new FeeEngine({
    platformFeeBps:       opts.platformFeeBps,
    developerShareBps:    opts.developerShareBps,
    freeTierMonthlyUnits: opts.freeTierMonthlyUnits ?? 0n,
    premiumTiers:         opts.premiumTiers ?? [],
  })
}
