// ─── SDK Error classes ────────────────────────────────────────────────────────

import type { FacilitatorError } from './types.js'

export class FacilitatorAPIError extends Error {
  public readonly code: string
  public readonly reason: string
  public readonly correlationId?: string
  public readonly httpStatus: number

  constructor(error: FacilitatorError) {
    super(error.message)
    this.name = 'FacilitatorAPIError'
    this.code = error.code
    this.reason = error.reason
    this.correlationId = error.correlationId
    this.httpStatus = error.status
  }

  isRetryable(): boolean {
    return [
      'internal_error',
      'settlement_pending',
      'rpc_unavailable',
    ].includes(this.code)
  }

  isDuplicate(): boolean {
    return ['duplicate_payment', 'duplicate_settlement'].includes(this.code)
  }

  isExpired(): boolean {
    return this.code === 'expired_payment'
  }
}

export class FacilitatorNetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'FacilitatorNetworkError'
  }
}

export class FacilitatorTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`)
    this.name = 'FacilitatorTimeoutError'
  }
}
