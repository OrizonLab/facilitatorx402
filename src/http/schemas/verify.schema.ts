import { z } from 'zod'
import { VerifyRequestSchema } from '../../protocol/x402-parser.js'

export { VerifyRequestSchema }

export const VerifyResponseSchema = z.object({
  requestId:        z.string(),
  verificationId:   z.string(),
  paymentRequestId: z.string(),
  status:           z.literal('accepted'),
  network:          z.string(),
  asset:            z.string(),
  amount:           z.string(),
  from:             z.string(),
  to:               z.string(),
  invoiceId:        z.string(),
  expiresAt:        z.string().datetime(),
  verifiedAt:       z.string().datetime(),
})

export type VerifyResponse = z.infer<typeof VerifyResponseSchema>
