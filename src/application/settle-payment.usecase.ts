import { ulid } from 'ulid'
import { prisma } from '../infrastructure/db.js'
import { acquireLock, releaseLock } from '../infrastructure/redis.js'
import { logger } from '../infrastructure/logger.js'
import { settleDuration, settlementsTotal, commissionTotal, developerShareTotal } from '../infrastructure/metrics.js'
import { calculateFee } from '../settlement/fee-calculator.js'
import { submitTransfer, waitForConfirmation } from '../settlement/on-chain-transfer.js'
import { createError } from '../http/errors.js'

export interface SettleResult {
  settled: boolean
  settlementId: string
  requestId: string
  txHash?: string
  status: string
  receiptId?: string
  _idempotent?: boolean
}

export async function settlePaymentUseCase(
  requestId: string,
  referralCode: string | undefined,
): Promise<SettleResult> {
  const end = settleDuration.startTimer()
  const log = logger.child({ requestId, usecase: 'settle-payment' })

  // 1. Idempotence: return existing settlement if already done
  const existingSettlement = await prisma.paymentSettlement.findUnique({
    where: { requestId },
    include: { request: true },
  })

  if (existingSettlement) {
    log.info({ settlementId: existingSettlement.id, status: existingSettlement.settlementStatus }, 'Returning idempotent settlement')
    end({ status: existingSettlement.settlementStatus })
    return {
      settled: existingSettlement.settlementStatus === 'confirmed',
      settlementId: existingSettlement.id,
      requestId,
      txHash: existingSettlement.txHash ?? undefined,
      status: existingSettlement.settlementStatus,
      receiptId: undefined,
      _idempotent: true,
    }
  }

  // 2. Verify that payment was verified and accepted
  const verification = await prisma.paymentVerification.findUnique({
    where: { requestId },
    select: { verificationStatus: true },
  })

  if (!verification || verification.verificationStatus !== 'accepted') {
    throw createError('verification_required', {
      message: 'Payment must be verified and accepted before settlement',
      correlationId: requestId,
    })
  }

  // 3. Acquire distributed lock
  const lockAcquired = await acquireLock(requestId, 60)
  if (!lockAcquired) {
    throw createError('settlement_pending', {
      message: 'Settlement is already in progress for this request',
      correlationId: requestId,
    })
  }

  const settlementId = `set_${ulid()}`

  try {
    // 4. Load payment request
    const paymentRequest = await prisma.paymentRequest.findUniqueOrThrow({
      where: { id: requestId },
    })

    // 5. Calculate fees
    const { feeAmount, developerShare } = calculateFee(paymentRequest.amount, referralCode)

    // 6. Create pending settlement record
    await prisma.paymentSettlement.create({
      data: {
        id: settlementId,
        requestId,
        settlementStatus: 'pending',
        settlementId: `txid_${ulid()}`, // Will be updated with real txHash
        referralCode,
        feeAmount,
        developerShare,
      },
    })

    // 7. Submit on-chain transfer
    log.info({ settlementId, seller: paymentRequest.seller, amount: paymentRequest.amount.toString() }, 'Submitting settlement')
    const txHash = await submitTransfer({
      to: paymentRequest.seller,
      amount: paymentRequest.amount - feeAmount,
      requestId,
    })

    // 8. Update with txHash immediately
    await prisma.paymentSettlement.update({
      where: { id: settlementId },
      data: { txHash, settlementId: txHash },
    })

    // 9. Wait for confirmation
    await waitForConfirmation(txHash, requestId)

    const confirmedAt = new Date()

    // 10. Mark confirmed
    await prisma.paymentSettlement.update({
      where: { id: settlementId },
      data: {
        settlementStatus: 'confirmed',
        confirmedAt,
      },
    })

    // 11. Generate receipt
    const receiptId = `rec_${ulid()}`
    await prisma.paymentReceipt.create({
      data: {
        id: receiptId,
        requestId,
        protocolVersion: 'x402/v1',
        responsePayload: {
          receiptId,
          requestId,
          settlementId,
          txHash,
          amount: paymentRequest.amount.toString(),
          asset: paymentRequest.asset,
          network: paymentRequest.network,
          seller: paymentRequest.seller,
          buyer: paymentRequest.buyer,
          feeAmount: feeAmount.toString(),
          developerShare: developerShare.toString(),
          confirmedAt: confirmedAt.toISOString(),
        },
      },
    })

    // 12. Update metrics
    settlementsTotal.inc({ status: 'confirmed' })
    commissionTotal.inc(Number(feeAmount - developerShare))
    developerShareTotal.inc(Number(developerShare))

    log.info({ settlementId, txHash, receiptId }, 'Settlement confirmed')
    end({ status: 'confirmed' })

    return {
      settled: true,
      settlementId,
      requestId,
      txHash,
      status: 'confirmed',
      receiptId,
    }
  } catch (err) {
    // Mark settlement as failed
    const errMessage = err instanceof Error ? err.message : 'Unknown error'
    await prisma.paymentSettlement.updateMany({
      where: { id: settlementId, settlementStatus: 'pending' },
      data: { settlementStatus: 'failed', errorReason: errMessage },
    })

    settlementsTotal.inc({ status: 'failed' })
    end({ status: 'failed' })
    log.error({ settlementId, err: errMessage }, 'Settlement failed')
    throw err
  } finally {
    await releaseLock(requestId)
  }
}
