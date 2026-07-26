/**
 * Verify endpoint — request/response TypeScript types.
 * The shape is stable across all V1 releases.
 */

export interface VerifyAccepted {
  requestId: string
  status: 'accepted'
  verificationId: string
  paymentRequestId: string
  network: string
  asset: string
  amount: string
  from: string
  to: string
  invoiceId: string
  expiresAt: string
  verifiedAt: string
}

export interface VerifyRejected {
  requestId: string
  status: 'rejected'
  error: {
    code: string
    message: string
  }
  httpStatus: number
  rejectedAt: string
}

export type VerifyResponse = VerifyAccepted | VerifyRejected
