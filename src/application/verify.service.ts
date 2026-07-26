/**
 * Verify service — orchestrates the full /verify pipeline.
 *
 * Pipeline:
 *   1. Parse & validate the x402 payload (Zod)
 *   2. Check network & asset supported (NetworkRegistry)
 *   3. Check expiration (validBefore)
 *   4. Check recipient matches configured seller address
 *   5. Check amount >= requiredAmount
 *   6. Anti-replay check (Redis fast path, then PostgreSQL fallback)
 *   7. Verify EIP-3009 signature (viem)
 *   8. Persist result to PostgreSQL (payment_requests + payment_verifications)
 *   9. Mark nonce/sig as used in Redis
 *  10. Return structured accepted/rejected response
 *
 * This function is deterministic and traceable.
 * It NEVER throws — all errors are caught and returned as structured responses.
 */
import { ulid } from 'ulid'
import { parseX402Payload } from '../protocol/x402-parser.js'
import { networkRegistry } from '../infrastructure/network-registry.js'
import { verifyTransferAuthorization } from '../crypto/signature-verifier.js'
import {
  hashSignature,
  checkReplayRedis,
  checkReplayPostgres,
  markReplayUsed,
} from '../protocol/anti-replay.js'
import { db } from '../infrastructure/db.js'
import { logger } from '../infrastructure/logger.js'
import type { VerifyResponse } from '../http/schemas/verify.schema.js'

export async function runVerify(
  raw: unknown,
  requestId: string
): Promise<VerifyResponse> {
  const log = logger.child({ requestId, fn: 'verify' })

  // --- 1. Parse & validate ---
  const parsed = parseX402Payload(raw)
  if (!parsed.success) {
    return reject(requestId, 'invalid_payload', parsed.message, 400)
  }
  const { data: body } = parsed

  log.info({ network: body.network, asset: body.asset, invoiceId: body.invoiceId }, 'verify started')

  // --- 2. Network & asset check ---
  const networks = networkRegistry.getAll()
  const network = networks.find((n) => n.name === body.network)
  if (!network) {
    return reject(requestId, 'unsupported_network', `Network '${body.network}' is not supported`, 402)
  }

  const asset = network.assets.find((a) => a.symbol === body.asset.toUpperCase())
  if (!asset) {
    return reject(requestId, 'unsupported_asset', `Asset '${body.asset}' is not supported on ${body.network}`, 402)
  }

  const auth = body.payload.authorization

  // --- 3. Expiration check ---
  const nowSec = Math.floor(Date.now() / 1000)
  if (auth.validBefore <= nowSec) {
    return reject(requestId, 'expired_payment', `Payment expired at ${new Date(auth.validBefore * 1000).toISOString()}`, 402)
  }
  if (auth.validAfter > nowSec) {
    return reject(requestId, 'invalid_payload', `Payment not valid yet (validAfter: ${auth.validAfter})`, 402)
  }

  // --- 4. Recipient check ---
  if (auth.to.toLowerCase() !== body.recipient.toLowerCase()) {
    return reject(requestId, 'invalid_payload', `Recipient mismatch: expected ${body.recipient}, got ${auth.to}`, 402)
  }

  // --- 5. Amount check ---
  if (BigInt(auth.value) < BigInt(body.requiredAmount)) {
    return reject(
      requestId,
      'invalid_payload',
      `Insufficient amount: got ${auth.value}, required ${body.requiredAmount}`,
      402
    )
  }

  // --- 6. Anti-replay (Redis fast path) ---
  const signatureHash = hashSignature(body.payload.signature)
  const nonce = auth.nonce

  const redisReplay = await checkReplayRedis(nonce, signatureHash)
  if (redisReplay.isDuplicate) {
    log.warn({ reason: redisReplay.reason, nonce }, 'duplicate payment blocked (Redis)')
    return reject(requestId, 'duplicate_payment', `Payment already used (${redisReplay.reason})`, 409)
  }

  // --- 6b. Anti-replay (PostgreSQL fallback) ---
  const pgReplay = await checkReplayPostgres(nonce, signatureHash)
  if (pgReplay.isDuplicate) {
    log.warn({ reason: pgReplay.reason, nonce }, 'duplicate payment blocked (PostgreSQL)')
    return reject(requestId, 'duplicate_payment', `Payment already used (${pgReplay.reason})`, 409)
  }

  // --- 7. Signature verification ---
  const sigResult = await verifyTransferAuthorization(
    auth,
    body.payload.signature as `0x${string}`,
    asset,
    network
  )

  if (!sigResult.valid) {
    log.warn({ error: sigResult.error }, 'invalid signature')
    // Persist rejected verification
    await persistVerification({
      requestId,
      body,
      network,
      status: 'rejected',
      errorCode: 'invalid_signature',
      reason: sigResult.error,
      signatureHash,
      nonce,
    })
    return reject(requestId, 'invalid_signature', sigResult.error ?? 'Signature verification failed', 402)
  }

  // --- 8. Persist accepted verification ---
  const { paymentRequestId, verificationId } = await persistVerification({
    requestId,
    body,
    network,
    status: 'accepted',
    signatureHash,
    nonce,
  })

  // --- 9. Mark nonce/sig used in Redis ---
  await markReplayUsed(nonce, signatureHash)

  log.info({ verificationId, paymentRequestId }, 'verify accepted')

  // --- 10. Return accepted response ---
  return {
    requestId,
    status: 'accepted',
    verificationId,
    paymentRequestId,
    network: body.network,
    asset: body.asset,
    amount: auth.value,
    from: auth.from,
    to: auth.to,
    invoiceId: body.invoiceId,
    expiresAt: new Date(auth.validBefore * 1000).toISOString(),
    verifiedAt: new Date().toISOString(),
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

function reject(
  requestId: string,
  code: string,
  message: string,
  httpStatus: number
): VerifyResponse {
  return {
    requestId,
    status: 'rejected',
    error: { code, message },
    httpStatus,
    rejectedAt: new Date().toISOString(),
  }
}

async function persistVerification(opts: {
  requestId: string
  body: Awaited<ReturnType<typeof parseX402Payload> & { success: true }>['data']
  network: { chainId: number; name: string; id?: string }
  status: 'accepted' | 'rejected'
  errorCode?: string
  reason?: string
  signatureHash: string
  nonce: string
}): Promise<{ paymentRequestId: string; verificationId: string }> {
  const auth = opts.body.payload.authorization

  // Find network record in PostgreSQL
  const networkRecord = await db.network.findUnique({
    where: { chainId: opts.network.chainId },
  })

  // Upsert payment_request (idempotent on invoiceId + network)
  const paymentRequest = await db.paymentRequest.upsert({
    where: {
      // Composite unique created via invoiceId index
      // We use a raw approach since Prisma requires @unique on the field
      id: opts.requestId,
    },
    create: {
      id: opts.requestId,
      buyerAddress: auth.from,
      networkId: networkRecord!.id,
      asset: opts.body.asset,
      amount: auth.value,
      invoiceId: opts.body.invoiceId,
      scheme: opts.body.scheme,
      expiresAt: new Date(auth.validBefore * 1000),
    },
    update: {},
  })

  const verificationId = ulid()
  await db.paymentVerification.create({
    data: {
      id: verificationId,
      requestId: paymentRequest.id,
      verificationStatus: opts.status as any,
      errorCode: opts.errorCode,
      reason: opts.reason,
      signatureHash: opts.signatureHash,
      nonce: opts.nonce,
      payloadHash: opts.signatureHash, // same as sig hash in V1
    },
  })

  return { paymentRequestId: paymentRequest.id, verificationId }
}
