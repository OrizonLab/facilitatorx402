import type { PrismaClient } from '@prisma/client'
import type { Logger } from 'pino'

export type AuditAction =
  | 'verify.accepted'
  | 'verify.rejected'
  | 'settle.pending'
  | 'settle.confirmed'
  | 'settle.failed'
  | 'receipt.read'

export interface AuditEntry {
  entityType: 'payment_request' | 'payment_verification' | 'payment_settlement' | 'payment_receipt'
  entityId: string
  action: AuditAction
  actor: string          // seller address or 'system'
  payload?: Record<string, unknown>
}

/**
 * Write a structured audit log entry to the DB.
 * Fire-and-forget — never throws: audit failure must not block the main flow.
 */
export async function writeAuditLog(
  prisma: PrismaClient,
  logger: Logger,
  entry: AuditEntry,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: entry.entityType,
        entityId:   entry.entityId,
        action:     entry.action,
        actor:      entry.actor,
        payload:    entry.payload ?? {},
      },
    })
  } catch (err) {
    // Audit failure is non-fatal — log the error but do not propagate
    logger.error({ err, entry }, 'audit.write.failed')
  }
}

/**
 * Query audit trail for a given entity.
 */
export async function getAuditTrail(
  prisma: PrismaClient,
  entityType: AuditEntry['entityType'],
  entityId: string,
) {
  return prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'asc' },
  })
}
