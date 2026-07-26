// ─── Core types for @orizonlab/x402-client ───────────────────────────────────

export interface FacilitatorClientOptions {
  /** Base URL of the facilitatorx402 instance. E.g. https://facilitator.orizonlab.io */
  url: string
  /** Optional API key for seller/agent authentication */
  apiKey?: string
  /** Request timeout in ms (default: 10000) */
  timeout?: number
  /** Max retries on network errors (default: 2) */
  retries?: number
  /** Custom fetch implementation (useful for edge runtimes, robots) */
  fetch?: typeof globalThis.fetch
}

export interface X402PaymentProof {
  /** x402 protocol version */
  x402Version: number
  /** Payment scheme (e.g. "exact") */
  scheme: string
  /** Network identifier (e.g. "base") */
  network: string
  /** Asset contract address */
  asset: string
  /** Recipient (seller) address */
  recipient: string
  /** Amount in asset base units */
  amount: string
  /** Invoice binding identifier */
  invoiceId: string
  /** Expiry timestamp (Unix seconds) */
  expiresAt: number
  /** EIP-191 signature of the payment */
  signature: string
  /** Nonce to prevent replay */
  nonce: string
  /** Payer (buyer) address */
  payer: string
}

export interface VerifyResponse {
  status: 'accepted' | 'rejected'
  requestId: string
  verificationId: string
  reason?: string
  errorCode?: string
  correlationId?: string
}

export interface SettleResponse {
  status: 'confirmed' | 'pending' | 'failed'
  settlementId: string
  requestId: string
  txHash?: string
  feeAmount?: string
  developerShare?: string
  receiptId: string
  confirmedAt?: string
  correlationId?: string
}

export interface Receipt {
  receiptId: string
  requestId: string
  settlementId: string
  protocolVersion: number
  seller: string
  buyer: string
  network: string
  asset: string
  amount: string
  txHash: string
  feeAmount: string
  developerShare: string
  status: string
  createdAt: string
  confirmedAt?: string
}

export interface SupportedConfig {
  versions: number[]
  networks: string[]
  assets: string[]
  schemes: string[]
  extensions: string[]
  limits: {
    minAmount: string
    maxAmount: string
    maxExpirySeconds: number
  }
  settlement: {
    confirmations: number
    timeoutSeconds: number
  }
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down'
  version: string
  checks: {
    api: boolean
    database: boolean
    redis: boolean
    worker: boolean
    rpc: boolean
  }
  uptime: number
}

export interface FacilitatorError {
  code: string
  reason: string
  message: string
  correlationId?: string
  status: number
}
