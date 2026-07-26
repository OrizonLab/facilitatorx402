import { z } from 'zod'

// ─── Zod schemas ────────────────────────────────────────────────────────────

export const AuthorizationSchema = z.object({
  from: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid from address'),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid to address'),
  value: z.string().regex(/^\d+$/, 'Invalid value: must be a decimal string'),
  validAfter: z.number().int().nonnegative(),
  validBefore: z.number().int().positive(),
  nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid nonce: must be 0x + 32 bytes hex'),
})

export const VerifyPayloadSchema = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, 'Invalid signature: must be 0x + 65 bytes hex'),
  authorization: AuthorizationSchema,
})

export const VerifyRequestSchema = z.object({
  version: z.literal('1'),
  scheme: z.literal('exact'),
  network: z.string().min(1),
  asset: z.string().min(1),
  invoiceId: z.string().min(1).max(255),
  requiredAmount: z.string().regex(/^\d+$/, 'Invalid requiredAmount: must be a decimal string'),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid recipient address'),
  payload: VerifyPayloadSchema,
})

export type VerifyRequest = z.infer<typeof VerifyRequestSchema>
export type Authorization = z.infer<typeof AuthorizationSchema>
export type VerifyPayload = z.infer<typeof VerifyPayloadSchema>

// ─── Parser ─────────────────────────────────────────────────────────────────

export interface ParseResult {
  success: true
  data: VerifyRequest
}

export interface ParseError {
  success: false
  issues: { path: string; message: string }[]
}

export function parseVerifyRequest(raw: unknown): ParseResult | ParseError {
  const result = VerifyRequestSchema.safeParse(raw)
  if (!result.success) {
    return {
      success: false,
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    }
  }
  return { success: true, data: result.data }
}
