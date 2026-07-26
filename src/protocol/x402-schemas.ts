import { z } from 'zod'

const ethereumAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid Ethereum address')
  .transform((v) => v.toLowerCase())

const hexSignature = z.string().regex(/^0x[0-9a-fA-F]+$/, 'Invalid hex signature')

export const verifyPayloadSchema = z.object({
  version: z.literal('x402/v1'),
  network: z.object({
    chainId: z.number().int().positive(),
  }),
  asset: z.object({
    address: ethereumAddress,
  }),
  amount: z.string().regex(/^\d+$/, 'Amount must be a non-negative integer string'),
  seller: ethereumAddress,
  buyer: ethereumAddress,
  invoiceId: z.string().min(1).max(255),
  expiresAt: z.string().datetime(),
  nonce: z.string().min(1).max(255),
  signature: hexSignature,
  scheme: z.literal('erc20-transfer'),
})

export type VerifyPayload = z.infer<typeof verifyPayloadSchema>

export const settlePayloadSchema = z.object({
  requestId: z.string().min(1),
  referralCode: z.string().max(64).optional(),
})

export type SettlePayload = z.infer<typeof settlePayloadSchema>
