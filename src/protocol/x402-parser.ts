/**
 * x402 payload parser & schema validator.
 *
 * Parses and validates the raw body sent to POST /verify.
 * Uses Zod for strict input validation — all fields typed.
 *
 * x402 V1 payload shape:
 * {
 *   version: "1",
 *   scheme: "exact",
 *   network: "base-mainnet",
 *   payload: {
 *     signature: "0x...",
 *     authorization: {
 *       from: "0x...",
 *       to: "0x...",
 *       value: "1000000",
 *       validAfter: 0,
 *       validBefore: 1753523400,
 *       nonce: "0x...",
 *     }
 *   }
 * }
 */
import { z } from 'zod'

const EthAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid Ethereum address')

const Bytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{1,66}$/, 'Invalid bytes32 value')

const HexSignature = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/, 'Invalid 65-byte EIP-712 signature (must be 0x + 130 hex chars)')

export const X402AuthorizationSchema = z.object({
  from: EthAddress,
  to: EthAddress,
  value: z.string().regex(/^\d+$/, 'value must be a decimal string'),
  validAfter: z.number().int().nonnegative(),
  validBefore: z.number().int().positive(),
  nonce: Bytes32,
})

export const X402PayloadSchema = z.object({
  signature: HexSignature,
  authorization: X402AuthorizationSchema,
})

export const X402VerifyBodySchema = z.object({
  version: z.literal('1'),
  scheme: z.literal('exact'),
  network: z.string().min(1).max(64),
  asset: z.string().min(1).max(20).toUpperCase(),
  invoiceId: z.string().min(1).max(255),
  requiredAmount: z.string().regex(/^\d+$/, 'requiredAmount must be a decimal string'),
  recipient: EthAddress,
  payload: X402PayloadSchema,
})

export type X402VerifyBody = z.infer<typeof X402VerifyBodySchema>
export type X402Authorization = z.infer<typeof X402AuthorizationSchema>

/**
 * Parse and validate a raw verify request body.
 * Returns the typed payload or a structured error.
 */
export function parseX402Payload(
  raw: unknown
): { success: true; data: X402VerifyBody } | { success: false; code: string; message: string } {
  const result = X402VerifyBodySchema.safeParse(raw)
  if (!result.success) {
    const first = result.error.errors[0]
    return {
      success: false,
      code: 'invalid_payload',
      message: first ? `${first.path.join('.')}: ${first.message}` : 'Validation failed',
    }
  }
  return { success: true, data: result.data }
}
