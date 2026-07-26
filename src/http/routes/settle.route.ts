/**
 * POST /settle
 *
 * Submits an on-chain settlement for a verified x402 payment.
 *
 * Idempotent: calling with the same requestId always returns the same result.
 * The settlement job is enqueued in BullMQ (Redis) and processed asynchronously.
 * For V1, we wait up to 30s for confirmation before returning pending status.
 *
 * Webhooks fired:
 *   payment.settled  — on confirmed status
 *   payment.failed   — on failed status
 *
 * HTTP status codes:
 *   200 — confirmed or pending
 *   400 — invalid payload
 *   402 — payment not verified / already settled
 *   409 — duplicate settlement
 *   500 — internal error
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { runSettle } from '../../application/settle.service.js'
import { notifyWebhook } from '../../application/webhook.service.js'
import { logger } from '../../infrastructure/logger.js'

const SettleBodySchema = z.object({
  requestId: z.string().min(1).max(128),
  verificationId: z.string().min(1).max(128),
  referralCode: z.string().max(50).optional(),
})

export async function registerSettleRoute(app: FastifyInstance): Promise<void> {
  app.post('/settle', {
    schema: {
      tags: ['x402'],
      summary: 'Settle a verified x402 payment on-chain',
      description: [
        'Submits the on-chain transferWithAuthorization for a verified payment.',
        '',
        '**Idempotent**: calling twice with the same `requestId` returns the same result.',
        'The same payment can never be settled twice.',
        '',
        '**Steps performed:**',
        '1. Validate payload',
        '2. Check settlement does not already exist (idempotence)',
        '3. Lock the request (Redis SETNX)',
        '4. Submit on-chain via viem',
        '5. Wait for confirmation',
        '6. Compute fees (platform + developer share)',
        '7. Persist settlement + receipt to PostgreSQL',
        '8. Fire webhook `payment.settled` or `payment.failed` (async)',
      ].join('\n'),
      body: {
        type: 'object',
        required: ['requestId', 'verificationId'],
        properties: {
          requestId: { type: 'string', example: '01J9XXXXXXXXXXXXXXXXXXX' },
          verificationId: { type: 'string', example: '01J9YYYYYYYYYYYYY' },
          referralCode: { type: 'string', example: 'PARTNER42' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
            status: { type: 'string', enum: ['confirmed', 'pending'] },
            settlementId: { type: 'string' },
            txHash: { type: 'string' },
            feeAmount: { type: 'string' },
            developerShare: { type: 'string' },
            receiptId: { type: 'string' },
            confirmedAt: { type: 'string' },
            settledAt: { type: 'string' },
          },
        },
        402: { type: 'object' },
        409: { type: 'object' },
      },
    },
  }, async (request, reply) => {
    const parsed = SettleBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        requestId: '',
        status: 'rejected',
        error: { code: 'invalid_payload', message: parsed.error.errors[0]?.message ?? 'Validation failed' },
        httpStatus: 400,
        failedAt: new Date().toISOString(),
      })
    }

    const { requestId, verificationId, referralCode } = parsed.data

    try {
      const result = await runSettle({ requestId, verificationId, referralCode })

      if (result.status === 'failed' || result.status === 'rejected') {
        const httpStatus = (result as any).httpStatus ?? 402

        // Notify webhook on failure too (payment.failed)
        notifyWebhook({
          event: 'payment.failed',
          sellerId: (result as any).sellerId,
          payload: {
            requestId,
            error: (result as any).error,
            failedAt: (result as any).failedAt ?? new Date().toISOString(),
          },
        }).catch((err) => logger.warn({ err, requestId }, 'webhook notify failed (payment.failed)'))

        return reply.status(httpStatus).send(result)
      }

      // Notify webhook on success (payment.settled)
      if (result.status === 'confirmed') {
        notifyWebhook({
          event: 'payment.settled',
          sellerId: (result as any).sellerId,
          payload: {
            requestId: result.requestId,
            settlementId: result.settlementId,
            txHash: result.txHash,
            feeAmount: result.feeAmount,
            developerShare: result.developerShare,
            receiptId: result.receiptId,
            confirmedAt: result.confirmedAt,
          },
        }).catch((err) => logger.warn({ err, requestId }, 'webhook notify failed (payment.settled)'))
      }

      return reply.status(200).send(result)
    } catch (err: any) {
      logger.error({ err, requestId }, 'settle internal error')
      return reply.status(500).send({
        requestId,
        status: 'failed',
        error: { code: 'internal_error', message: 'An internal error occurred. Please retry.' },
        httpStatus: 500,
        failedAt: new Date().toISOString(),
      })
    }
  })
}
