export interface FacilitatorClientOptions {
  /** Base URL of the facilitator instance */
  url: string
  /** API key for authenticated seller endpoints */
  apiKey?: string
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number
  /** Max retries on transient errors (default: 3) */
  maxRetries?: number
  /** User-Agent string (useful for identifying robots/agents) */
  userAgent?: string
}

export interface VerifyPaymentPayload {
  /** x402 protocol version */
  x402Version: number
  /** Payment scheme identifier */
  scheme: string
  /** Network chain ID (e.g. 8453 for Base) */
  network: string
  /** Payload with signature and payment details */
  payload: {
    signature: string
    authorization: {
      from: string
      to: string
      value: string
      validAfter: string
      validBefore: string
      nonce: string
    }
  }
  /** Required payment amount in smallest unit */
  requiredAmount: string
  /** Payment recipient address */
  payTo: string
  /** Asset contract address */
  asset: string
  /** Invoice ID for binding */
  invoiceId?: string
  /** Expiration timestamp (ISO 8601) */
  expiresAt: string
}

export interface VerifyResponse {
  status: 'accepted' | 'rejected'
  requestId: string
  verificationId: string
  reason?: string
  code?: string
  correlationId?: string
}

export interface SettleResponse {
  status: 'confirmed' | 'pending' | 'failed'
  requestId: string
  settlementId: string
  txHash?: string
  receiptId?: string
  feeAmount?: string
  developerShare?: string
  confirmedAt?: string
  code?: string
  reason?: string
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down'
  version: string
  checks: {
    database: 'ok' | 'error'
    redis: 'ok' | 'error'
    rpc: 'ok' | 'error'
    worker: 'ok' | 'error'
  }
  uptime: number
  timestamp: string
}

export interface SupportedResponse {
  x402Versions: number[]
  networks: string[]
  assets: Record<string, { symbol: string; decimals: number; address: string }>
  schemes: string[]
  extensions: string[]
  limits: { minAmount: string; maxAmount: string }
  settlement: { confirmations: number; timeoutMs: number }
}

export interface ReceiptResponse {
  id: string
  requestId: string
  protocolVersion: string
  status: string
  txHash?: string
  feeAmount?: string
  developerShare?: string
  seller?: string
  buyer?: string
  amount?: string
  asset?: string
  network?: string
  confirmedAt?: string
  createdAt: string
  responsePayload?: unknown
}

export interface WebhookSubscription {
  id: string
  url: string
  events: WebhookEvent[]
  active: boolean
  secret: string
  createdAt: string
}

export type WebhookEvent =
  | 'settlement.confirmed'
  | 'settlement.failed'
  | 'verify.accepted'
  | 'verify.rejected'

export interface SellerRegistration {
  sellerId: string
  apiKey: string
  walletAddress: string
  createdAt: string
}
