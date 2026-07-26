/**
 * Seller test server — Phase 7
 *
 * A minimal Express server that protects a resource behind x402 payment.
 * Demonstrates the full facilitator integration flow:
 *   1. GET /premium/data → 402 if no payment proof
 *   2. POST /purchase   → calls facilitator /verify then /settle
 *   3. GET /premium/data with receiptId → 200 + data
 *
 * Run:
 *   FACILITATOR_URL=http://localhost:3000 pnpm ts-node examples/seller-server/server.ts
 */
import express, { type Request, type Response, type NextFunction } from 'express'
import { createPaymentRequirement, verifyAndSettle } from './facilitator-client.js'

const app = express()
app.use(express.json())

const SELLER_ADDRESS = process.env.SELLER_ADDRESS ?? '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const PORT          = Number(process.env.PORT ?? 3001)

// ─── Middleware: require payment ───────────────────────────────────────────
async function requirePayment(req: Request, res: Response, next: NextFunction) {
  const proof = req.headers['x-payment-proof']
    ? JSON.parse(req.headers['x-payment-proof'] as string)
    : null

  // No proof → return 402 with payment requirements
  if (!proof) {
    const requirement = createPaymentRequirement({
      seller:         SELLER_ADDRESS,
      invoiceId:      `inv_${req.path}_${Date.now()}`,
      requiredAmount: '1000000',  // 1.00 USDC
      description:    `Access: ${req.method} ${req.path}`,
    })
    return res
      .status(402)
      .set('x-payment-required', 'version=1')
      .json(requirement)
  }

  // Proof present → verify + settle via facilitator
  try {
    const t0 = Date.now()
    const result = await verifyAndSettle(proof)
    const latencyMs = Date.now() - t0

    console.log(JSON.stringify({
      event:      'payment.settled',
      latencyMs,
      requestId:  result.requestId,
      receiptId:  result.receiptId,
      txHash:     result.txHash,
    }))

    ;(req as any).receiptId  = result.receiptId
    ;(req as any).requestId  = result.requestId
    next()
  } catch (err: any) {
    return res.status(402).json({
      error: {
        code:    err.code ?? 'payment_failed',
        reason:  err.reason ?? 'Payment verification or settlement failed',
        message: err.message,
      },
    })
  }
}

// ─── Protected route ─────────────────────────────────────────────────────
app.get('/premium/data', requirePayment, (req: Request, res: Response) => {
  res.json({
    data:      { value: 42, source: 'premium-feed', ts: new Date().toISOString() },
    receiptId: (req as any).receiptId,
    requestId: (req as any).requestId,
  })
})

// ─── Health ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', seller: SELLER_ADDRESS }))

app.listen(PORT, () => {
  console.log(`[seller] Listening on :${PORT}`)
  console.log(`[seller] Facilitator: ${process.env.FACILITATOR_URL ?? 'http://localhost:3000'}`)
})
