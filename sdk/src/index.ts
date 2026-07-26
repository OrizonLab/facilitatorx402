/**
 * @orizonlab/x402-client — TypeScript SDK V2
 *
 * Seller-side SDK for integrating with the facilitatorx402 service.
 *
 * Features:
 *   - verifyPayment(proof, opts)    → POST /verify wrapper
 *   - settlePayment(opts)           → POST /settle wrapper
 *   - getReceipt(receiptId)         → GET /receipts/:id wrapper
 *   - verifyWebhookSignature(...)   → HMAC-SHA256 webhook verification
 *   - Express/Fastify/Hono middleware
 *
 * Usage:
 *   import { X402Client } from '@orizonlab/x402-client'
 *
 *   const client = new X402Client({
 *     facilitatorUrl: 'https://facilitator.example.com',
 *     sellerId: 'seller_abc',
 *     webhookSecret: 'wh_secret_xxx',
 *   })
 *
 *   // In your Express middleware:
 *   app.use('/premium', client.middleware({ amount: '1000000', asset: 'USDC', network: 'base-mainnet' }))
 */
import crypto from 'crypto'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface X402ClientOptions {
  facilitatorUrl: string
  sellerId: string
  webhookSecret?: string
  referralCode?: string
  timeoutMs?: number
}

export interface PaymentProof {
  x402Version: string
  scheme: string
  network: string
  payload: {
    signature: `0x${string}`
    authorization: {
      from: string
      to: string
      value: string
      validAfter: string
      validBefore: string
      nonce: string
    }
  }
  resource: string
  required: {
    maxAmountRequired: string
    asset: string
    payTo: string
    invoiceId: string
    expires: string
  }
}

export interface VerifyResult {
  requestId: string
  verificationId: string
  status: 'accepted' | 'rejected'
  network?: string
  asset?: string
  amount?: string
  verifiedAt?: string
  error?: { code: string; message: string }
}

export interface SettleResult {
  requestId: string
  status: 'confirmed' | 'pending' | 'failed' | 'rejected'
  settlementId?: string
  txHash?: string
  feeAmount?: string
  developerShare?: string
  receiptId?: string
  confirmedAt?: string
  settledAt?: string
  error?: { code: string; message: string }
}

export interface Receipt {
  receiptId: string
  requestId: string
  protocolVersion: string
  network: string
  asset: string
  grossAmount: string
  feeAmount: string
  developerShare: string
  netAmount: string
  feeBps: number
  txHash: string
  referralCode: string | null
  confirmedAt: string
  createdAt: string
}

export interface MiddlewareOptions {
  amount: string
  asset: string
  network: string
  invoiceId?: string
  description?: string
  autoSettle?: boolean // default: true
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class X402Client {
  private readonly baseUrl: string
  private readonly sellerId: string
  private readonly webhookSecret: string
  private readonly referralCode?: string
  private readonly timeoutMs: number

  constructor(opts: X402ClientOptions) {
    this.baseUrl = opts.facilitatorUrl.replace(/\/$/, '')
    this.sellerId = opts.sellerId
    this.webhookSecret = opts.webhookSecret ?? ''
    this.referralCode = opts.referralCode
    this.timeoutMs = opts.timeoutMs ?? 30_000
  }

  async verifyPayment(proof: PaymentProof): Promise<VerifyResult> {
    const res = await this.post('/verify', proof)
    return res as VerifyResult
  }

  async settlePayment(opts: { requestId: string; verificationId: string; referralCode?: string }): Promise<SettleResult> {
    const res = await this.post('/settle', {
      requestId: opts.requestId,
      verificationId: opts.verificationId,
      referralCode: opts.referralCode ?? this.referralCode,
    })
    return res as SettleResult
  }

  async getReceipt(receiptId: string): Promise<Receipt> {
    const res = await this.get(`/receipts/${receiptId}`)
    return res as Receipt
  }

  async getSupportedNetworks() {
    return this.get('/supported')
  }

  /**
   * Verify a webhook signature from the facilitator.
   * Call this in your webhook handler before processing the event.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!this.webhookSecret || !signatureHeader) return false
    const expected = 'sha256=' + crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex')
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))
    } catch {
      return false
    }
  }

  /**
   * Express/Connect middleware.
   * Returns 402 if no valid X-Payment header.
   * Automatically verifies + settles on each request.
   *
   * @example
   * app.use('/premium', client.expressMiddleware({ amount: '1000000', asset: 'USDC', network: 'base-mainnet' }))
   */
  expressMiddleware(opts: MiddlewareOptions) {
    return async (req: any, res: any, next: any) => {
      const paymentHeader = req.headers['x-payment']

      if (!paymentHeader) {
        return res.status(402).json({
          x402Version: '1',
          error: 'Payment required',
          accepts: [{
            scheme: 'exact',
            network: opts.network,
            maxAmountRequired: opts.amount,
            asset: opts.asset,
            payTo: req.app.locals?.sellerWallet ?? '',
            description: opts.description ?? 'Access requires payment',
            invoiceId: opts.invoiceId ?? `inv_${Date.now()}`,
          }],
        })
      }

      try {
        const proof = JSON.parse(Buffer.from(paymentHeader, 'base64').toString())
        const verified = await this.verifyPayment(proof)

        if (verified.status !== 'accepted') {
          return res.status(402).json({ error: verified.error })
        }

        if (opts.autoSettle !== false) {
          const settled = await this.settlePayment({
            requestId: verified.requestId,
            verificationId: verified.verificationId,
          })
          if (settled.status !== 'confirmed') {
            return res.status(402).json({ error: settled.error })
          }
          req.x402 = { verified, settled, receiptId: settled.receiptId }
        } else {
          req.x402 = { verified }
        }

        next()
      } catch (err: any) {
        return res.status(500).json({ error: { code: 'internal_error', message: err.message } })
      }
    }
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Seller-Id': this.sellerId },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      return res.json()
    } finally {
      clearTimeout(timeout)
    }
  }

  private async get(path: string): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: { 'X-Seller-Id': this.sellerId },
        signal: controller.signal,
      })
      return res.json()
    } finally {
      clearTimeout(timeout)
    }
  }
}

export { verifyWebhookSignature } from './webhook-verify.js'
