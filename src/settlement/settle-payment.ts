import type { PrismaClient } from '@prisma/client'
import type { Redis } from 'ioredis'
import type { Logger } from 'pino'
import { submitOnChain } from './on-chain.js'
import { createFeeEngine } from './fee-engine.js'
import { createError } from '../http/errors.js'
import type { NetworkRegistry } from '../application/verify-payment.js'
import { getConfig } from '../infrastructure/config.js'

const SETTLE_LOCK_PREFIX = 'settle_lock:'
const SETTLE_LOCK_TTL = 120 // seconds — matches confirmation timeout

export interface SettleDeps {
  prisma: PrismaClient
  redis: Redis
  logger: Logger
  networkRegistry: NetworkRegistry
  relayerPrivateKey: string
}

export interface SettleRequest {
  paymentRequestId: string
  referralCode?: string
}

export interface SettleResult {
  settled: boolean
  settlementId: string
  requestId: string
  txHash: string
  status: 'confirmed'
  receiptId: string
  _idempotent?: boolean
}

export interface SettlePendingResult {
  settled: false
  requestId: string
  error: { code: string; message: string }
}

/**
 * Core settle use case.
 * Idempotent: same paymentRequestId always returns the same result.
 * Locked: only one concurrent settle per request.
 */
export async function settlePayment(
  req: SettleRequest,
  deps: SettleDeps,
): Promise<SettleResult | SettlePendingResult> {
  const { prisma, redis, logger, networkRegistry } = deps
  const { paymentRequestId, referralCode } = req

  const log = logger.child({ paymentRequestId })
  log.info('settle.start')

  // 1. Load payment request
  const paymentRequest = await prisma.paymentRequest.findUnique({
    where: { id: paymentRequestId },
    include: { verifications: { where: { verificationStatus: 'accepted' } } },
  })

  if (!paymentRequest) {
    throw createError('verification_required', {
      message: `No payment request found: ${paymentRequestId}`,
      correlationId: paymentRequestId,
    })
  }

  // 2. Verification must exist
  if (!paymentRequest.verifications.length) {
    throw createError('verification_required', {
      message: 'Payment has not been verified (accepted) yet',
      correlationId: paymentRequestId,
    })
  }

  // 3. Idempotence check — already settled?
  const existing = await prisma.paymentSettlement.findFirst({
    where: {
      requestId: paymentRequestId,
      settlementStatus: 'confirmed',
    },
    include: { receipt: true },
  })

  if (existing) {
    log.info({ settlementId: existing.id }, 'settle.idempotent')
    return {
      settled: true,
      settlementId: existing.id,
      requestId: paymentRequestId,
      txHash: existing.txHash ?? '',
      status: 'confirmed',
      receiptId: existing.receipt?.id ?? '',
      _idempotent: true,
    }
  }

  // 4. Lock — prevent concurrent settlement
  const lockKey = `${SETTLE_LOCK_PREFIX}${paymentRequestId}`
  const locked = await redis.set(lockKey, '1', 'EX', SETTLE_LOCK_TTL, 'NX')
  if (locked !== 'OK') {
    log.warn('settle.locked')
    return {
      settled: false,
      requestId: paymentRequestId,
      error: { code: 'settlement_pending', message: 'Settlement already in progress' },
    }
  }

  // 5. Persist settlement as 'pending' before going on-chain
  const settlementId = generateId()
  await prisma.paymentSettlement.create({
    data: {
      id: settlementId,
      requestId: paymentRequestId,
      settlementStatus: 'pending',
      referralCode: referralCode ?? null,
    },
  })

  log.info({ settlementId }, 'settle.pending_created')

  try {
    // 6. Resolve network + asset config from NetworkRegistry
    const network = networkRegistry.getNetwork(paymentRequest.network)
    if (!network) throw new Error(`Unknown network: ${paymentRequest.network}`)
    const asset = network.assets[paymentRequest.asset]
    if (!asset) throw new Error(`Unknown asset: ${paymentRequest.asset}`)

    const verification = paymentRequest.verifications[0]!
    const config = getConfig()

    // 7. Submit on-chain via canonical on-chain.ts (ERC-3009, correct ABI, multi-RPC)
    const onChainResult = await submitOnChain({
      from:           paymentRequest.buyer as `0x${string}`,
      to:             paymentRequest.seller as `0x${string}`,
      value:          paymentRequest.amount,
      validAfter:     BigInt(0),
      validBefore:    BigInt(Math.floor(paymentRequest.expiresAt.getTime() / 1000)),
      nonce:          verification.nonce as `0x${string}`,
      signature:      verification.signatureHash as `0x${string}`,
      assetAddress:   asset.contractAddress as `0x${string}`,
      chainId:        network.chainId,
      rpcUrl:         config.RPC_URL,
      fallbackRpcUrl: config.RPC_URL_FALLBACK ?? null,
    })

    // 8. Compute fees via FeeEngine (supports free tier + premium tiers)
    const feeEngine = createFeeEngine({
      platformFeeBps:    config.PLATFORM_FEE_BPS,
      developerShareBps: config.DEVELOPER_SHARE_BPS,
    })
    const fees = feeEngine.compute(
      paymentRequest.amount,
      paymentRequest.seller,
      referralCode ?? null,
    )

    // 9. Persist confirmed settlement + receipt atomically
    const receiptId = generateId()
    const confirmedAt = new Date()

    await prisma.$transaction(async (tx) => {
      await tx.paymentSettlement.update({
        where: { id: settlementId },
        data: {
          settlementStatus: 'confirmed',
          txHash:           onChainResult.txHash,
          feeAmount:        fees.platformFee,
          developerShare:   fees.developerShare,
          confirmedAt,
        },
      })

      await tx.paymentReceipt.create({
        data: {
          id:              receiptId,
          requestId:       paymentRequestId,
          settlementId,
          protocolVersion: '1',
          responsePayload: {
            network:         paymentRequest.network,
            asset:           paymentRequest.asset,
            seller:          paymentRequest.seller,
            buyer:           paymentRequest.buyer,
            amount:          paymentRequest.amount.toString(),
            txHash:          onChainResult.txHash,
            feeAmount:       fees.platformFee.toString(),
            developerShare:  fees.developerShare.toString(),
            confirmedAt:     confirmedAt.toISOString(),
          },
        },
      })
    })

    log.info({ settlementId, txHash: onChainResult.txHash, receiptId }, 'settle.confirmed')

    return {
      settled:      true,
      settlementId,
      requestId:    paymentRequestId,
      txHash:       onChainResult.txHash,
      status:       'confirmed',
      receiptId,
    }
  } catch (err) {
    // 10. Persist failure + release lock
    log.error({ err, settlementId }, 'settle.failed')

    await prisma.paymentSettlement.update({
      where: { id: settlementId },
      data: { settlementStatus: 'failed' },
    })

    await redis.del(lockKey)

    throw createError('settlement_failed', {
      message: 'The on-chain transaction failed. No funds were moved.',
      correlationId: paymentRequestId,
    })
  } finally {
    // Always release lock on success path (failure releases in catch above)
    await redis.del(lockKey).catch(() => {})
  }
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
