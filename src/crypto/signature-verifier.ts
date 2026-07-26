/**
 * EIP-3009 / EIP-712 signature verifier using viem.
 *
 * Verifies transferWithAuthorization signatures:
 *   - ERC-3009 (USDC on Base uses this)
 *   - The signer must match authorization.from
 *
 * Domain: the ERC-20 token contract (chainId + verifyingContract)
 * Types: TransferWithAuthorization (EIP-3009)
 */
import { createPublicClient, http, recoverTypedDataAddress } from 'viem'
import { base } from 'viem/chains'
import type { X402Authorization } from '../protocol/x402-parser.js'
import type { SupportedAsset, SupportedNetwork } from '../infrastructure/network-registry.js'

// EIP-3009 domain & types
const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

export interface SignatureVerificationResult {
  valid: boolean
  recoveredAddress?: string
  error?: string
}

/**
 * Verify an EIP-3009 TransferWithAuthorization signature.
 *
 * @param authorization - The authorization object from the x402 payload
 * @param signature     - The 65-byte EIP-712 signature (0x-prefixed)
 * @param asset         - The asset config (address = token contract)
 * @param network       - The network config (chainId)
 */
export async function verifyTransferAuthorization(
  authorization: X402Authorization,
  signature: `0x${string}`,
  asset: SupportedAsset,
  network: SupportedNetwork
): Promise<SignatureVerificationResult> {
  try {
    const domain = {
      name: asset.symbol, // 'USDC' on Base
      version: '2',       // USDC on Base uses version 2
      chainId: network.chainId,
      verifyingContract: asset.address as `0x${string}`,
    }

    const message = {
      from: authorization.from as `0x${string}`,
      to: authorization.to as `0x${string}`,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce as `0x${string}`,
    }

    const recovered = await recoverTypedDataAddress({
      domain,
      types: EIP3009_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
      signature,
    })

    const valid = recovered.toLowerCase() === authorization.from.toLowerCase()

    return {
      valid,
      recoveredAddress: recovered,
      error: valid ? undefined : `Signature mismatch: expected ${authorization.from}, got ${recovered}`,
    }
  } catch (err: any) {
    return {
      valid: false,
      error: `Signature verification failed: ${err?.message ?? 'unknown error'}`,
    }
  }
}
