import type {
  FacilitatorClientOptions,
  VerifyPaymentPayload,
  VerifyResponse,
  SettleResponse,
  HealthResponse,
  SupportedResponse,
  ReceiptResponse,
  WebhookSubscription,
  WebhookEvent,
  SellerRegistration,
} from './types.js'
import { FacilitatorError } from './facilitator-error.js'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_USER_AGENT = 'facilitatorx402-sdk/1.1.0'

export class FacilitatorClient {
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly userAgent: string

  constructor(options: FacilitatorClientOptions) {
    this.baseUrl = options.url.replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT
  }

  // ─── Operator ─────────────────────────────────────────────────────────────

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/health')
  }

  async supported(): Promise<SupportedResponse> {
    return this.request<SupportedResponse>('GET', '/supported')
  }

  // ─── Payments ─────────────────────────────────────────────────────────────

  /**
   * Verify a payment proof.
   * Call this after receiving the x402 payload from the buyer.
   *
   * @param payload - The x402 payment proof from the buyer
   * @returns VerifyResponse with status 'accepted' or 'rejected'
   */
  async verify(payload: VerifyPaymentPayload): Promise<VerifyResponse> {
    return this.request<VerifyResponse>('POST', '/verify', payload)
  }

  /**
   * Settle a previously verified payment.
   * Idempotent — safe to call multiple times with the same requestId.
   *
   * @param requestId - The requestId returned by verify()
   * @returns SettleResponse with tx hash and receipt ID once confirmed
   */
  async settle(requestId: string): Promise<SettleResponse> {
    return this.request<SettleResponse>('POST', '/settle', { requestId })
  }

  /**
   * Retrieve an audit receipt by its ID.
   */
  async getReceipt(receiptId: string): Promise<ReceiptResponse> {
    return this.request<ReceiptResponse>('GET', `/receipts/${receiptId}`)
  }

  // ─── Sellers ──────────────────────────────────────────────────────────────

  /**
   * Register a new seller and receive an API key.
   * The generated wallet address is custodial — managed by the facilitator.
   *
   * Useful for autonomous devices (robots, IoT) that cannot manage
   * private keys directly.
   */
  async registerSeller(params: {
    name: string
    referralCode?: string
    deviceType?: 'server' | 'robot' | 'iot' | 'agent'
    webhookUrl?: string
  }): Promise<SellerRegistration> {
    return this.request<SellerRegistration>('POST', '/sellers/register', params)
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to push notifications for payment events.
   * Critical for autonomous devices that cannot poll for status.
   */
  async createWebhook(params: {
    url: string
    events: WebhookEvent[]
  }): Promise<WebhookSubscription> {
    return this.request<WebhookSubscription>('POST', '/webhooks', params)
  }

  async listWebhooks(): Promise<WebhookSubscription[]> {
    return this.request<WebhookSubscription[]>('GET', '/webhooks')
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    return this.request<void>('DELETE', `/webhooks/${webhookId}`)
  }

  // ─── Complete flow helper ─────────────────────────────────────────────────

  /**
   * Convenience method: verify then settle in one call.
   * Returns the receipt ID once confirmed.
   *
   * @example
   * ```ts
   * // Used by AI agents or robots for a fully autonomous payment flow
   * const { receiptId, txHash } = await client.pay(paymentProof)
   * ```
   */
  async pay(payload: VerifyPaymentPayload): Promise<{ receiptId: string; txHash: string; status: string }> {
    const verify = await this.verify(payload)
    if (verify.status !== 'accepted') {
      throw new FacilitatorError({
        code: verify.code ?? 'verify_rejected',
        reason: verify.reason ?? 'Payment verification rejected',
        message: `Verification rejected: ${verify.reason}`,
      })
    }
    const settle = await this.settle(verify.requestId)
    return {
      receiptId: settle.receiptId ?? '',
      txHash: settle.txHash ?? '',
      status: settle.status,
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    attempt = 1
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': this.userAgent,
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } catch (err: unknown) {
      clearTimeout(timer)
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      if (!isTimeout && attempt < this.maxRetries) {
        await this.sleep(attempt * 500)
        return this.request<T>(method, path, body, attempt + 1)
      }
      throw new FacilitatorError({
        code: isTimeout ? 'request_timeout' : 'network_error',
        reason: isTimeout ? 'Request timed out' : 'Network error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 204) return undefined as T

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new FacilitatorError({
        code: 'invalid_response',
        reason: 'Non-JSON response',
        message: `Server returned non-JSON response (HTTP ${response.status})`,
        httpStatus: response.status,
      })
    }

    if (!response.ok) {
      const err = data as Record<string, unknown>
      const facilitatorError = new FacilitatorError({
        code: (err.code as string) ?? 'unknown_error',
        reason: (err.reason as string) ?? 'Unknown error',
        message: (err.message as string) ?? `HTTP ${response.status}`,
        httpStatus: response.status,
        correlationId: err.correlationId as string | undefined,
      })

      // Retry on transient errors
      if (FacilitatorError.isRetryable(facilitatorError) && attempt < this.maxRetries) {
        await this.sleep(attempt * 1000)
        return this.request<T>(method, path, body, attempt + 1)
      }

      throw facilitatorError
    }

    return data as T
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
