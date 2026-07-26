/**
 * Settlement confirmation worker — BullMQ async confirmation flow.
 *
 * Responsibilities:
 *   1. Poll the RPC for transaction receipt (waitForTransactionReceipt via viem)
 *   2. Confirm or fail the settlement record in PostgreSQL
 *   3. Generate the payment receipt on confirmation
 *   4. Emit metrics (confirmed / failed / duration)
 *   5. Retry with exponential backoff (5 attempts, 2s base)
 *   6. Release Redis lock on success or final failure
 *
 * In V1 synchronous mode, settle.service.ts submits the tx inline.
 * This worker handles:
 *   - Async confirmation tracking (enqueued after tx submission)
 *   - Retry on RPC timeout or network hiccup
 *   - Final failure persistence if all retries exhausted
 *
 * Job payload:
 *   { settlementId, txHash, requestId, chainId, rpcUrl, fallbackRpcUrl }
 */
import { Worker, Queue, type Job } from 'bullmq'
import { createPublicClient, http, type Hash } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { redis } from '../redis.js'
import { db } from '../db.js'
import { logger } from '../logger.js'
import {
  settleTotal,
  settleDuration,
  commissionGeneratedTotal,
  developerShareTotal,
  bullmqQueueDepth,
  rpcErrorsTotal,
} from '../metrics.js'
import { computeFees } from '../../settlement/fee-engine.js'
import { ulid } from 'ulid'

// ─── Queue name ──────────────────────────────────────────────────────────────
export const SETTLEMENT_QUEUE = 'settlement-confirmations'

// ─── Queue export (for enqueueing from settle.service) ───────────────────────
export const settlementQueue = new Queue(SETTLEMENT_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
})

// ─── Job payload type ─────────────────────────────────────────────────────────
export interface SettlementConfirmationJob {
  settlementId: string
  txHash: string
  requestId: string
  chainId: number
  rpcUrl: string
  fallbackRpcUrl?: string
  grossAmount: string       // stringified BigInt
  referralCode?: string
}

// ─── Chain resolution helper ─────────────────────────────────────────────────
function resolveChain(chainId: number) {
  switch (chainId) {
    case 8453:  return base
    case 84532: return baseSepolia
    default:    return baseSepolia
  }
}

// ─── Core confirmation logic ──────────────────────────────────────────────────
async function confirmSettlement(job: Job<SettlementConfirmationJob>): Promise<void> {
  const { settlementId, txHash, requestId, chainId, rpcUrl, fallbackRpcUrl, grossAmount, referralCode } = job.data
  const log = logger.child({ settlementId, txHash, requestId, jobId: job.id, fn: 'confirm-worker' })
  const startedAt = Date.now()

  log.info('Confirming settlement on-chain...')

  // ── Check if already confirmed (idempotent retry safety) ──
  const existing = await db.paymentSettlement.findUnique({
    where: { id: settlementId },
    select: { settlementStatus: true, confirmedAt: true },
  })

  if (existing?.settlementStatus === 'confirmed') {
    log.info('Settlement already confirmed — skipping')
    return
  }

  if (existing?.settlementStatus === 'failed') {
    log.warn('Settlement already marked failed — skipping retry')
    return
  }

  // ── Build viem client (with fallback) ──
  const chain = resolveChain(chainId)
  let receipt: Awaited<ReturnType<ReturnType<typeof createPublicClient>['waitForTransactionReceipt']>> | null = null

  const clients = [
    createPublicClient({ chain, transport: http(rpcUrl) }),
    ...(fallbackRpcUrl ? [createPublicClient({ chain, transport: http(fallbackRpcUrl) })] : []),
  ]

  // ── Poll with primary, then fallback ──
  for (const client of clients) {
    try {
      receipt = await client.waitForTransactionReceipt({
        hash: txHash as Hash,
        timeout: 60_000,
        confirmations: 1,
      })
      break
    } catch (err: any) {
      log.warn({ err: err.message, rpc: (client as any).transport?.url }, 'RPC failed, trying fallback...')
      rpcErrorsTotal.inc({ rpc_url: rpcUrl })
    }
  }

  if (!receipt) {
    throw new Error(`Transaction ${txHash} not confirmed after polling all RPCs`)
  }

  // ── Check on-chain status ──
  if (receipt.status !== 'success') {
    log.error({ receipt }, 'On-chain tx reverted')
    await db.paymentSettlement.update({
      where: { id: settlementId },
      data: { settlementStatus: 'failed' },
    })
    settleTotal.inc({ status: 'failed' })
    throw new Error(`On-chain tx reverted: ${txHash}`)
  }

  // ── Compute fees ──
  const fees = computeFees(BigInt(grossAmount))
  const confirmedAt = new Date()
  const receiptId = ulid()

  // ── Persist in a transaction ──
  await db.$transaction(async (tx) => {
    await tx.paymentSettlement.update({
      where: { id: settlementId },
      data: {
        settlementStatus: 'confirmed',
        txHash,
        feeAmount: fees.platformFee.toString(),
        developerShare: fees.developerShare.toString(),
        confirmedAt,
        updatedAt: confirmedAt,
      },
    })

    // Upsert receipt (idempotent — may already exist from sync path)
    const existingReceipt = await tx.paymentReceipt.findUnique({
      where: { requestId },
    })

    if (!existingReceipt) {
      const network = await tx.paymentRequest
        .findUnique({ where: { id: requestId }, include: { network: true } })
        .then((r) => r?.network?.name ?? 'unknown')

      const assetSymbol = await tx.paymentRequest
        .findUnique({ where: { id: requestId }, select: { asset: true } })
        .then((r) => r?.asset ?? 'USDC')

      await tx.paymentReceipt.create({
        data: {
          id: receiptId,
          requestId,
          protocolVersion: 'x402-v1',
          responsePayload: {
            settlementId,
            txHash,
            network,
            asset: assetSymbol,
            grossAmount,
            feeAmount: fees.platformFee.toString(),
            developerShare: fees.developerShare.toString(),
            netAmount: fees.netAmount.toString(),
            feeBps: fees.feeBps,
            referralCode: referralCode ?? null,
            confirmedAt: confirmedAt.toISOString(),
          },
        },
      })
    }
  })

  // ── Release Redis lock ──
  await redis.del(`settle:lock:${requestId}`).catch(() => {})

  // ── Metrics ──
  const durationSec = (Date.now() - startedAt) / 1000
  settleTotal.inc({ status: 'confirmed' })
  settleDuration.observe(durationSec)
  commissionGeneratedTotal.inc(Number(fees.platformFee))
  developerShareTotal.inc(Number(fees.developerShare))

  log.info({ receiptId, durationSec }, 'Settlement confirmed via worker')
}

// ─── Worker factory ──────────────────────────────────────────────────────────
export function startSettlementWorker(): Worker {
  const worker = new Worker<SettlementConfirmationJob>(
    SETTLEMENT_QUEUE,
    confirmSettlement,
    {
      connection: redis,
      concurrency: 5,
      limiter: { max: 10, duration: 1000 }, // 10 jobs/sec max
    },
  )

  worker.on('active', (job) => {
    logger.debug({ jobId: job.id, settlementId: job.data.settlementId }, 'Worker job active')
  })

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, settlementId: job.data.settlementId }, 'Worker job completed')
  })

  worker.on('failed', (job, err) => {
    const isLastAttempt = (job?.attemptsMade ?? 0) >= (job?.opts?.attempts ?? 5)
    logger.error(
      { jobId: job?.id, settlementId: job?.data?.settlementId, err: err.message, isLastAttempt },
      'Worker job failed'
    )
    if (isLastAttempt) {
      // Persist final failure state
      if (job?.data?.settlementId) {
        db.paymentSettlement
          .update({
            where: { id: job.data.settlementId },
            data: { settlementStatus: 'failed' },
          })
          .catch(() => {})
        settleTotal.inc({ status: 'failed' })
      }
    }
  })

  worker.on('error', (err) => {
    logger.error({ err: err.message }, 'Settlement worker error')
  })

  // ── Queue depth polling (every 5s) ──
  setInterval(async () => {
    try {
      const counts = await settlementQueue.getJobCounts('wait', 'active', 'delayed', 'failed')
      bullmqQueueDepth.set({ queue: 'settlement-confirmations' }, (counts.wait ?? 0) + (counts.delayed ?? 0))
    } catch (_) {}
  }, 5000)

  logger.info({ queue: SETTLEMENT_QUEUE, concurrency: 5 }, 'Settlement confirmation worker started')
  return worker
}
