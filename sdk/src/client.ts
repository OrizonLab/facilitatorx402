// ─── FacilitatorClient — main SDK entry point ─────────────────────────────────

import type {
  FacilitatorClientOptions,
  X402PaymentProof,
  VerifyResponse,
  SettleResponse,
  Receipt,
  SupportedConfig,
  HealthStatus,
} from './types.js'
import {
  FacilitatorAPIError,
  FacilitatorNetworkError,
  FacilitatorTimeoutError,
} from './errors.js'

const DEFAULT_TIMEOUT = 10_000
const DEFAULT_RETRIES = 2

export class FacilitatorClient {
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly timeout: number
  private readonly retries: number
  private readonly fetchFn: typeof globalThis.fetch

  constructor(options: FacilitatorClientOptions) {
    this.baseUrl = options.url.replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT
    this.retries = options.retries ?? DEFAULT_RETRIES
    this.fetchFn = options.fetch ?? globalThis.fetch
  }

  // ─── Core payment methods ──────────────────────────────────────────────────

  /**
   * Verify a payment proof.
   * Fast, deterministic, no on-chain call.
   * Use this before granting any access to a paid resource.
   */
  async verify(proof: X402PaymentProof): Promise<VerifyResponse> {
    return this.post<VerifyResponse>('/verify', proof)
  }

  /**
   * Settle a previously verified payment.
   * Idempotent — safe to call multiple times with the same requestId.
   * Submits on-chain transaction and returns receipt.
   */
  async settle(requestId: string): Promise<SettleResponse> {
    return this.post<SettleResponse>('/settle', { requestId })
  }

  /**
   * One-shot: verify then settle in sequence.
   * Convenience method for simple integrations.
   * Returns the settlement receipt directly.
   */
  async pay(proof: X402PaymentProof): Promise<{ verify: VerifyResponse; settle: SettleResponse }> {
    const verify = await this.verify(proof)
    if (verify.status !== 'accepted') {
      throw new FacilitatorAPIError({
        code: verify.errorCode ?? 'verify_rejected',
        reason: verify.reason ?? 'Payment verification rejected',
        message: `Payment was rejected: ${verify.reason}`,
        correlationId: verify.correlationId,
        status: 402,
      })
    }
    const settle = await this.settle(verify.requestId)
    return { verify, settle }
  }

  // ─── Utility methods ───────────────────────────────────────────────────────

  /** Fetch a payment receipt by ID */
  async getReceipt(receiptId: string): Promise<Receipt> {
    return this.get<Receipt>(`/receipts/${receiptId}`)
  }

  /** Get supported networks, assets, schemes and limits */
  async getSupported(): Promise<SupportedConfig> {
    return this.get<SupportedConfig>('/supported')
  }

  /** Health check — useful for robots to verify facilitator availability before attempting payment */
  async health(): Promise<HealthStatus> {
    return this.get<HealthStatus>('/health')
  }

  /**
   * Poll settlement status until confirmed or failed.
   * Useful for robots/agents that cannot use webhooks.
   * @param settlementId  Settlement ID from settle()
   * @param options       Polling options
   */
  async pollSettlement(
    receiptId: string,
    options: { intervalMs?: number; maxAttempts?: number } = {}
  ): Promise<Receipt> {
    const { intervalMs = 2000, maxAttempts = 30 } = options
    for (let i = 0; i < maxAttempts; i++) {
      const receipt = await this.getReceipt(receiptId)
      if (receipt.status === 'confirmed' || receipt.status === 'failed') {
        return receipt
      }
      await sleep(intervalMs)
    }
    throw new FacilitatorTimeoutError(intervalMs * maxAttempts)
  }

  // ─── HTTP internals ────────────────────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, undefined)
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  private async request<T>(method: string, path: string, body: unknown, attempt = 0): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': '@orizonlab/x402-client/0.1.0',
    }
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await this.fetchFn(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      clearTimeout(timer)

      const json = (await res.json()) as T | { error: { code: string; reason: string; message: string; correlationId?: string } }

      if (!res.ok) {
        const errBody = json as { error: { code: string; reason: string; message: string; correlationId?: string } }
        const apiErr = new FacilitatorAPIError({
          ...errBody.error,
          status: res.status,
        })
        // Retry on retryable errors
        if (apiErr.isRetryable() && attempt < this.retries) {
          await sleep(200 * 2 ** attempt)
          return this.request<T>(method, path, body, attempt + 1)
        }
        throw apiErr
      }

      return json as T
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof FacilitatorAPIError || err instanceof FacilitatorTimeoutError) throw err
      if ((err as Error).name === 'AbortError') throw new FacilitatorTimeoutError(this.timeout)
      // Network error — retry
      if (attempt < this.retries) {
        await sleep(200 * 2 ** attempt)
        return this.request<T>(method, path, body, attempt + 1)
      }
      throw new FacilitatorNetworkError(`Network error: ${(err as Error).message}`, err)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
