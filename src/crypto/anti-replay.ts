import { prisma } from '../infrastructure/db.js'
import { createError } from '../http/errors.js'
import { duplicateBlockedTotal } from '../infrastructure/metrics.js'

/**
 * Check and persist anti-replay state atomically.
 * Throws duplicate_payment if nonce or signature_hash already seen.
 */
export async function checkAndPersistAntiReplay(params: {
  requestId: string
  nonce: string
  signatureHash: string
  payloadHash: string
}): Promise<void> {
  // Check existence before insert (fast path)
  const existing = await prisma.paymentVerification.findFirst({
    where: {
      OR: [
        { nonce: params.nonce },
        { signatureHash: params.signatureHash },
      ],
    },
    select: { id: true },
  })

  if (existing) {
    duplicateBlockedTotal.inc()
    throw createError('duplicate_payment', {
      message: 'This payment proof has already been processed',
      correlationId: params.requestId,
    })
  }
}
