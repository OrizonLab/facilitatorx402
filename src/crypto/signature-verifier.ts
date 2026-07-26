import { createHash } from 'crypto'
import { recoverMessageAddress, hashMessage } from 'viem'
import type { Hex, Address } from 'viem'
import { createError } from '../http/errors.js'

/**
 * Build the EIP-191 message that the buyer signed.
 * Format: x402|{chainId}|{assetAddress}|{amount}|{seller}|{invoiceId}|{expiresAt}|{nonce}
 */
export function buildSignedMessage(params: {
  chainId: number
  assetAddress: string
  amount: string
  seller: string
  invoiceId: string
  expiresAt: string
  nonce: string
}): string {
  return [
    'x402',
    params.chainId.toString(),
    params.assetAddress.toLowerCase(),
    params.amount,
    params.seller.toLowerCase(),
    params.invoiceId,
    params.expiresAt,
    params.nonce,
  ].join('|')
}

export async function verifySignature(params: {
  chainId: number
  assetAddress: string
  amount: string
  seller: string
  invoiceId: string
  expiresAt: string
  nonce: string
  signature: string
  expectedBuyer: string
}): Promise<void> {
  const message = buildSignedMessage(params)

  let recovered: Address
  try {
    recovered = await recoverMessageAddress({
      message,
      signature: params.signature as Hex,
    })
  } catch {
    throw createError('invalid_signature', {
      message: 'Could not recover signer address from signature',
    })
  }

  if (recovered.toLowerCase() !== params.expectedBuyer.toLowerCase()) {
    throw createError('invalid_signature', {
      message: `Signature signer ${recovered} does not match expected buyer ${params.expectedBuyer}`,
    })
  }
}

export function computeSignatureHash(signature: string): string {
  return createHash('sha256').update(signature).digest('hex')
}

export function computePayloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}
