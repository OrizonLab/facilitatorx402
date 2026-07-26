import { recoverTypedDataAddress, type Address, type Hex } from 'viem'
import type { Authorization } from '../protocol/x402-parser.js'

export interface VerifySignatureParams {
  authorization: Authorization
  signature: Hex
  contractAddress: Address  // USDC contract address on the chain
  chainId: number
  eip712Version: string     // '2' for USDC on Base
}

/**
 * EIP-712 domain for ERC-3009 TransferWithAuthorization
 * https://eips.ethereum.org/EIPS/eip-712
 */
const ERC3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
} as const

/**
 * Verify an ERC-3009 TransferWithAuthorization signature.
 * Returns the recovered signer address, or throws on invalid signature.
 */
export async function verifyErc3009Signature({
  authorization,
  signature,
  contractAddress,
  chainId,
  eip712Version,
}: VerifySignatureParams): Promise<Address> {
  const domain = {
    name: 'USD Coin',
    version: eip712Version,
    chainId,
    verifyingContract: contractAddress,
  } as const

  const message = {
    from:        authorization.from as Address,
    to:          authorization.to as Address,
    value:       BigInt(authorization.value),
    validAfter:  BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce:       authorization.nonce as Hex,
  } as const

  const recovered = await recoverTypedDataAddress({
    domain,
    types: ERC3009_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
    signature,
  })

  return recovered
}

/**
 * Compute a stable hash of the signature bytes for DB deduplication.
 * We use the raw signature as the dedup key (hex string, lowercased).
 */
export function computeSignatureHash(signature: string): string {
  return signature.toLowerCase()
}
