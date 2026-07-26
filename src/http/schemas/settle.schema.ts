/**
 * Settle endpoint — request/response TypeScript types.
 * Shape is stable across all V1 releases.
 */

export interface SettleRequest {
  requestId: string
  verificationId: string
  referralCode?: string
}

export interface SettleAccepted {
  requestId: string
  status: 'confirmed' | 'pending'
  settlementId: string
  txHash?: string
  feeAmount?: string
  developerShare?: string
  receiptId?: string
  confirmedAt?: string
  settledAt: string
}

export interface SettleRejected {
  requestId: string
  status: 'failed' | 'rejected'
  error: {
    code: string
    message: string
  }
  httpStatus: number
  failedAt: string
}

export type SettleResponse = SettleAccepted | SettleRejected
