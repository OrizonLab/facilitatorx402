import type { PrismaClient } from '@prisma/client'
import { createError } from '../http/errors.js'
import { writeAuditLog } from './audit-logger.js'
import type { Logger } from 'pino'

export interface ReceiptDTO {
  receiptId: string
  requestId: string
  settlementId: string
  protocolVersion: string
  network: { name: string; chainId: string }
  asset: { symbol: string }
  seller: string
  buyer: string
  amount: string
  txHash: string
  feeAmount: string
  developerShare: string
  referralCode: string | null
  confirmedAt: string
  createdAt: string
}

export async function getReceiptById(
  id: string,
  prisma: PrismaClient,
  logger: Logger,
): Promise<ReceiptDTO> {
  const receipt = await prisma.paymentReceipt.findUnique({
    where: { id },
    include: {
      request:    true,
      settlement: true,
    },
  })

  if (!receipt) {
    throw createError('not_found', { message: `No receipt found for id: ${id}` })
  }

  const payload = receipt.responsePayload as Record<string, unknown>

  // Fire-and-forget audit
  void writeAuditLog(prisma, logger, {
    entityType: 'payment_receipt',
    entityId:   receipt.id,
    action:     'receipt.read',
    actor:      'operator',
    payload:    { receiptId: receipt.id },
  })

  return {
    receiptId:       receipt.id,
    requestId:       receipt.requestId,
    settlementId:    receipt.settlementId ?? '',
    protocolVersion: receipt.protocolVersion,
    network: {
      name:    String(payload.network ?? ''),
      chainId: String(receipt.request?.network ?? ''),
    },
    asset: {
      symbol: String(payload.asset ?? ''),
    },
    seller:         String(payload.seller ?? ''),
    buyer:          String(payload.buyer ?? ''),
    amount:         String(payload.amount ?? ''),
    txHash:         String(payload.txHash ?? ''),
    feeAmount:      String(payload.feeAmount ?? ''),
    developerShare: String(payload.developerShare ?? ''),
    referralCode:   receipt.settlement?.referralCode ?? null,
    confirmedAt:    String(payload.confirmedAt ?? ''),
    createdAt:      receipt.createdAt.toISOString(),
  }
}

/**
 * List receipts for a seller address (operator dashboard use case).
 */
export async function listReceiptsBySeller(
  seller: string,
  prisma: PrismaClient,
  opts: { page?: number; perPage?: number } = {},
): Promise<ReceiptDTO[]> {
  const page    = opts.page ?? 1
  const perPage = Math.min(opts.perPage ?? 20, 100)
  const skip    = (page - 1) * perPage

  const receipts = await prisma.paymentReceipt.findMany({
    where: { request: { seller } },
    include: { request: true, settlement: true },
    orderBy: { createdAt: 'desc' },
    skip,
    take: perPage,
  })

  return receipts.map((receipt) => {
    const payload = receipt.responsePayload as Record<string, unknown>
    return {
      receiptId:       receipt.id,
      requestId:       receipt.requestId,
      settlementId:    receipt.settlementId ?? '',
      protocolVersion: receipt.protocolVersion,
      network:  { name: String(payload.network ?? ''), chainId: String(receipt.request?.network ?? '') },
      asset:    { symbol: String(payload.asset ?? '') },
      seller:         String(payload.seller ?? ''),
      buyer:          String(payload.buyer ?? ''),
      amount:         String(payload.amount ?? ''),
      txHash:         String(payload.txHash ?? ''),
      feeAmount:      String(payload.feeAmount ?? ''),
      developerShare: String(payload.developerShare ?? ''),
      referralCode:   receipt.settlement?.referralCode ?? null,
      confirmedAt:    String(payload.confirmedAt ?? ''),
      createdAt:      receipt.createdAt.toISOString(),
    }
  })
}
