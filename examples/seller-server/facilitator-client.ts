/**
 * Facilitator SDK client — seller-side.
 *
 * Wraps POST /verify, POST /settle, GET /receipts/:id
 * with typed responses, structured errors and latency logging.
 */

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'http://localhost:3000'

export interface PaymentRequirement {
  version:        string
  scheme:         string
  network:        string
  asset:          string
  invoiceId:      string
  requiredAmount: string
  recipient:      string
  description?:   string
}

export interface VerifyResult {
  paymentRequestId: string
  verificationId:   string
  status:           'accepted' | 'rejected'
}

export interface SettleResult {
  settled:      boolean
  settlementId: string
  requestId:    string
  txHash:       string
  status:       string
  receiptId:    string
}

export interface PaymentResult extends VerifyResult, SettleResult {}

class FacilitatorError extends Error {
  code:   string
  reason: string
  constructor(data: { code: string; reason: string; message: string }) {
    super(data.message)
    this.code   = data.code
    this.reason = data.reason
  }
}

async function facilitatorPost<T>(path: string, body: unknown): Promise<T> {
  const t0  = Date.now()
  const res = await fetch(`${FACILITATOR_URL}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })

  const data = await res.json() as any
  const ms   = Date.now() - t0

  console.log(JSON.stringify({ event: `facilitator${path}`, statusCode: res.status, latencyMs: ms }))

  if (!res.ok) {
    const err = data.error ?? data
    throw new FacilitatorError({
      code:    err.code    ?? 'facilitator_error',
      reason:  err.reason  ?? 'Unknown error',
      message: err.message ?? JSON.stringify(err),
    })
  }

  return data as T
}

export function createPaymentRequirement(
  opts: { seller: string; invoiceId: string; requiredAmount: string; description?: string },
): PaymentRequirement {
  return {
    version:        '1',
    scheme:         'exact',
    network:        'base-mainnet',
    asset:          'USDC',
    invoiceId:      opts.invoiceId,
    requiredAmount: opts.requiredAmount,
    recipient:      opts.seller,
    description:    opts.description,
  }
}

export async function verifyPayment(proof: unknown): Promise<VerifyResult> {
  return facilitatorPost<VerifyResult>('/verify', proof)
}

export async function settlePayment(paymentRequestId: string, referralCode?: string): Promise<SettleResult> {
  return facilitatorPost<SettleResult>('/settle', { paymentRequestId, referralCode })
}

export async function verifyAndSettle(proof: unknown, referralCode?: string): Promise<PaymentResult> {
  const verify = await verifyPayment(proof)
  if (verify.status !== 'accepted') {
    throw new FacilitatorError({
      code:    'verify_rejected',
      reason:  'Payment proof was rejected',
      message: `Verification status: ${verify.status}`,
    })
  }
  const settle = await settlePayment(verify.paymentRequestId, referralCode)
  return { ...verify, ...settle }
}

export async function getReceipt(receiptId: string) {
  const res = await fetch(`${FACILITATOR_URL}/receipts/${receiptId}`)
  const data = await res.json() as any
  if (!res.ok) throw new FacilitatorError(data.error ?? data)
  return data
}
