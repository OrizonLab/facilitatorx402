export class FacilitatorError extends Error {
  public readonly code: string
  public readonly reason: string
  public readonly httpStatus?: number
  public readonly correlationId?: string

  constructor(params: {
    code: string
    reason: string
    message: string
    httpStatus?: number
    correlationId?: string
  }) {
    super(params.message)
    this.name = 'FacilitatorError'
    this.code = params.code
    this.reason = params.reason
    this.httpStatus = params.httpStatus
    this.correlationId = params.correlationId
  }

  static isRetryable(error: unknown): boolean {
    if (!(error instanceof FacilitatorError)) return false
    const retryable = ['internal_error', 'settlement_pending', 'rpc_unavailable']
    return retryable.includes(error.code)
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      reason: this.reason,
      message: this.message,
      httpStatus: this.httpStatus,
      correlationId: this.correlationId,
    }
  }
}
