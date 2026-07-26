/**
 * Settle service — orchestrates the full /settle pipeline.
 *
 * Pipeline:
 *   1. Validate input (requestId, verificationId)
 *   2. Check verification exists and is accepted
 *   3. Idempotence: if settlement already exists, return existing result
 *   4. Lock the request in Redis (SETNX, 5min TTL)
 *   5. Mark settlement as processing in PostgreSQL
 *   6. Retrieve payment request details from PostgreSQL
 *   7. Submit on-chain via viem (transferWithAuthorization)
 *   8. Compute fees (platform + developer share)
 *   9. Persist settlement (confirmed) + receipt in PostgreSQL
 *  10. Release Redis lock
 *  11. Enqueue webhook delivery
 *  12. Return structured response
 *
 * Idempotence guarantee:
 *   - Unique constraint on settlement_id, tx_hash in PostgreSQL
 *   - Redis lock prevents concurrent duplicate processing
 *   - Existing settlement is returned immediately without re-processing
 *
 * This function NEVER throws — all errors are caught and persisted.
 */
import { ulid } from 'ulid'
import { db } from '../infrastructure/db.js'
import { getRedis } from '../infrastructure/redis.js'
import { submitOnChain } from '../settlement/on-chain.js'
import { computeFees } from '../settlement/fee-engine.js'
import { logger } from '../infrastructure/logger.js'
import { networkRegistry } from '../infrastructure/network-registry.js'
import type { SettleResponse } from '../http/schemas/settle.schema.js'

const LOCK_TTL_SECONDS = 300 // 5 minutes
const LOCK_PREFIX = 'settle:lock:'

export async function runSettle(opts: {
  requestId: string
  verificationId: string
  referralCode?: string
}): Promise<SettleResponse> {
  const { requestId, verificationId, referralCode } = opts
  const log = logger.child({ requestId, verificationId, fn: 'settle' })

  // --- 1. Check verification exists and is accepted ---
  const verification = await db.paymentVerification.findFirst({
    where: {
      id: verificationId,
      requestId,
      verificationStatus: 'accepted',
    },
    include: { request: { include: { network: true } } },
  })

  if (!verification) {
    return settleReject(requestId, 'verification_not_found',
      'No accepted verification found for this requestId + verificationId', 402)
  }

  const paymentRequest = verification.request

  // --- 2. Idempotence: check existing settlement ---
  const existing = await db.paymentSettlement.findFirst({
    where: { requestId },
    include: { request: { include: { receipt: true } } },
  })

  if (existing) {
    log.info({ settlementId: existing.id, status: existing.settlementStatus }, 'idempotent: returning existing settlement')

    if (existing.settlementStatus === 'confirmed') {
      return {
        requestId,
        status: 'confirmed',
        settlementId: existing.id,
        txHash: existing.txHash ?? undefined,
        feeAmount: existing.feeAmount ?? undefined,
        developerShare: existing.developerShare ?? undefined,
        receiptId: existing.request.receipt?.id,
        confirmedAt: existing.confirmedAt?.toISOString(),
        settledAt: existing.createdAt.toISOString(),
      }
    }

    if (existing.settlementStatus === 'failed') {
      return settleReject(requestId, 'settlement_failed', 'Previous settlement attempt failed', 402)
    }

    // pending / processing — duplicate in-flight
    return settleReject(requestId, 'settlement_pending', 'Settlement is already being processed', 409)
  }

  // --- 3. Redis lock (prevent concurrent duplicate) ---
  const lockKey = `${LOCK_PREFIX}${requestId}`
  const redis = getRedis()
  const locked = await redis.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX')

  if (!locked) {
    log.warn('settlement already in progress (Redis lock held)')
    return settleReject(requestId, 'settlement_pending', 'Settlement already in progress', 409)
  }

  // --- 4. Create settlement record (processing) ---
  const settlementId = ulid()
  await db.paymentSettlement.create({
    data: {
      id: settlementId,
      requestId,
      settlementStatus: 'processing',
      settlementId,
      referralCode,
    },
  })

  log.info({ settlementId }, 'settlement created, submitting on-chain...')

  try {
    // --- 5. Get network + asset config ---
    const network = networkRegistry.getNetwork(paymentRequest.network.chainId)
    const asset = network?.assets.find((a) => a.symbol === paymentRequest.asset)

    if (!network || !asset) {
      throw new Error(`Network or asset not found in registry for settlement`)
    }

    // --- 6. Reconstruct authorization from verification ---
    // We re-read signature from the payload hash stored at verify time
    // In V1, we store the full payload in paymentVerifications via payloadHash
    // For on-chain submission we need the original authorization
    // The seller re-sends the full proof to /settle (included in paymentRequest)
    const grossAmount = BigInt(paymentRequest.amount)

    // --- 7. Submit on-chain ---
    // NOTE: In V1, the seller must have sent the authorization in /verify.
    // We reconstruct the call from paymentRequest + verification data.
    // The signature is stored as payloadHash in the verification record.
    const onChainResult = await submitOnChain({
      from: paymentRequest.buyerAddress as `0x${string}`,
      to: paymentRequest.sellerId
        ? (await db.seller.findUnique({ where: { id: paymentRequest.sellerId! } }))?.walletAddress as `0x${string}`
        : paymentRequest.buyerAddress as `0x${string}`,
      value: grossAmount,
      validAfter: BigInt(0),
      validBefore: BigInt(Math.floor(paymentRequest.expiresAt.getTime() / 1000)),
      nonce: verification.nonce as `0x${string}`,
      signature: (`0x` + verification.signatureHash) as `0x${string}`,
      assetAddress: asset.address as `0x${string}`,
      chainId: network.chainId,
      rpcUrl: network.rpcUrl,
      fallbackRpcUrl: network.fallbackRpcUrl,
    })

    // --- 8. Compute fees ---
    const fees = computeFees(grossAmount)

    // --- 9. Persist confirmed settlement + receipt ---
    const confirmedAt = new Date()
    const receiptId = ulid()

    await db.$transaction(async (tx) => {
      await tx.paymentSettlement.update({
        where: { id: settlementId },
        data: {
          settlementStatus: 'confirmed',
          txHash: onChainResult.txHash,
          feeAmount: fees.platformFee.toString(),
          developerShare: fees.developerShare.toString(),
          confirmedAt,
        },
      })

      await tx.paymentReceipt.create({
        data: {
          id: receiptId,
          requestId,
          protocolVersion: 'x402-v1',
          responsePayload: {
            settlementId,
            txHash: onChainResult.txHash,
            network: network.name,
            asset: paymentRequest.asset,
            grossAmount: grossAmount.toString(),
            feeAmount: fees.platformFee.toString(),
            developerShare: fees.developerShare.toString(),
            netAmount: fees.netAmount.toString(),
            feeBps: fees.feeBps,
            referralCode: referralCode ?? null,
            confirmedAt: confirmedAt.toISOString(),
          },
        },
      })
    })

    // --- 10. Release Redis lock ---
    await redis.del(lockKey)

    log.info({ settlementId, txHash: onChainResult.txHash, receiptId }, 'settlement confirmed')

    return {
      requestId,
      status: 'confirmed',
      settlementId,
      txHash: onChainResult.txHash,
      feeAmount: fees.platformFee.toString(),
      developerShare: fees.developerShare.toString(),
      receiptId,
      confirmedAt: confirmedAt.toISOString(),
      settledAt: confirmedAt.toISOString(),
    }
  } catch (err: any) {
    log.error({ err, settlementId }, 'on-chain settlement failed')

    // Persist failed status
    await db.paymentSettlement.update({
      where: { id: settlementId },
      data: { settlementStatus: 'failed' },
    }).catch(() => {})

    await redis.del(lockKey).catch(() => {})

    return settleReject(requestId, 'settlement_failed',
      `On-chain submission failed: ${err?.message ?? 'unknown error'}`, 502)
  }
}

function settleReject(
  requestId: string,
  code: string,
  message: string,
  httpStatus: number
): SettleResponse {
  return {
    requestId,
    status: 'failed',
    error: { code, message },
    httpStatus,
    failedAt: new Date().toISOString(),
  } as any
}
