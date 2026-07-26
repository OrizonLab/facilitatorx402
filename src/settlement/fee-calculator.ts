import { config } from '../infrastructure/config.js'

export interface FeeResult {
  feeAmount: bigint
  developerShare: bigint
  netAmount: bigint
}

export function calculateFee(amount: bigint, referralCode?: string): FeeResult {
  const feeBps = BigInt(config.PLATFORM_FEE_BPS)
  const feeAmount = (amount * feeBps) / 10000n

  let developerShare = 0n
  if (referralCode && feeAmount > 0n) {
    const sharePct = BigInt(config.DEVELOPER_SHARE_PERCENT)
    developerShare = (feeAmount * sharePct) / 100n
  }

  const netAmount = amount - feeAmount

  return { feeAmount, developerShare, netAmount }
}
