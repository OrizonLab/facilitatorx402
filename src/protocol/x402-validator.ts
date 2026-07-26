import { config } from '../infrastructure/config.js'
import { createError } from '../http/errors.js'
import type { VerifyPayload } from './x402-schemas.js'

export function validateNetworkAndAsset(payload: VerifyPayload): void {
  if (payload.network.chainId !== config.SUPPORTED_CHAIN_ID) {
    throw createError('unsupported_network', {
      message: `Network chainId ${payload.network.chainId} is not supported. Supported: ${config.SUPPORTED_CHAIN_ID}`,
    })
  }

  const supportedAsset = config.SUPPORTED_ASSET_ADDRESS.toLowerCase()
  if (payload.asset.address !== supportedAsset) {
    throw createError('unsupported_asset', {
      message: `Asset ${payload.asset.address} is not supported. Supported: ${supportedAsset}`,
    })
  }
}

export function validateExpiration(expiresAt: string): void {
  const tolerance = config.CLOCK_SKEW_TOLERANCE_SECONDS * 1000
  const expiresAtMs = new Date(expiresAt).getTime()
  const nowMs = Date.now()

  if (expiresAtMs + tolerance < nowMs) {
    throw createError('expired_payment', {
      message: `Payment proof expired at ${expiresAt}`,
    })
  }
}

export function validateAmount(payloadAmount: string): void {
  const amount = BigInt(payloadAmount)
  if (amount <= 0n) {
    throw createError('invalid_amount', {
      message: 'Amount must be greater than 0',
    })
  }
}
