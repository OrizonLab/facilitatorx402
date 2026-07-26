import { z } from 'zod'

// ─── Stable error codes ────────────────────────────────────────────────────────────────────

export const ERROR_CODES = [
  // Verify errors
  'unsupported_network',
  'unsupported_asset',
  'expired_payment',
  'invalid_signature',
  'invalid_nonce',
  'duplicate_payment',
  'invalid_amount',
  'invalid_seller',
  // Settle errors
  'settlement_pending',
  'duplicate_settlement',
  'settlement_failed',
  'verification_required',
  // Generic
  'validation_error',
  'not_found',
  'rate_limited',
  'internal_error',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

const HTTP_STATUS_MAP: Record<ErrorCode, number> = {
  unsupported_network: 422,
  unsupported_asset: 422,
  expired_payment: 422,
  invalid_signature: 422,
  invalid_nonce: 422,
  duplicate_payment: 409,
  invalid_amount: 422,
  invalid_seller: 422,
  settlement_pending: 202,
  duplicate_settlement: 200,
  settlement_failed: 422,
  verification_required: 422,
  validation_error: 400,
  not_found: 404,
  rate_limited: 429,
  internal_error: 500,
}

// ─── Error class ───────────────────────────────────────────────────────────────────────

export interface FacilitatorErrorOptions {
  message?: string
  correlationId?: string
}

export class FacilitatorError extends Error {
  public readonly code: ErrorCode
  public readonly httpStatus: number
  public readonly reason: string
  public readonly correlationId?: string

  constructor(code: ErrorCode, options: FacilitatorErrorOptions = {}) {
    const reason = REASONS[code]
    super(options.message ?? reason)
    this.name = 'FacilitatorError'
    this.code = code
    this.httpStatus = HTTP_STATUS_MAP[code]
    this.reason = reason
    this.correlationId = options.correlationId
  }
}

const REASONS: Record<ErrorCode, string> = {
  unsupported_network: 'Network not supported',
  unsupported_asset: 'Asset not supported',
  expired_payment: 'Payment proof has expired',
  invalid_signature: 'Signature verification failed',
  invalid_nonce: 'Nonce already used or invalid',
  duplicate_payment: 'Payment already processed',
  invalid_amount: 'Amount does not match invoice',
  invalid_seller: 'Seller address mismatch',
  settlement_pending: 'Settlement already in progress',
  duplicate_settlement: 'Settlement already completed',
  settlement_failed: 'On-chain transaction failed',
  verification_required: 'Payment must be verified first',
  validation_error: 'Request validation failed',
  not_found: 'Resource not found',
  rate_limited: 'Too many requests',
  internal_error: 'Internal server error',
}

export function createError(code: ErrorCode, options?: FacilitatorErrorOptions): FacilitatorError {
  return new FacilitatorError(code, options)
}

// ─── Response schema ─────────────────────────────────────────────────────────────────────

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    reason: z.string(),
    message: z.string(),
    correlationId: z.string().optional(),
  }),
})

export type ErrorResponse = z.infer<typeof errorResponseSchema>

export function toErrorResponse(err: FacilitatorError): ErrorResponse {
  return {
    error: {
      code: err.code,
      reason: err.reason,
      message: err.message,
      correlationId: err.correlationId,
    },
  }
}
