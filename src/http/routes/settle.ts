/**
 * POST /settle route.
 *
 * Security:
 *   - Per-seller rate limit: 30 req/min via X-Api-Key header (preHandler hook)
 *   - Global IP rate limit applied by @fastify/rate-limit in app.ts
 *   - Idempotent: second call with same requestId returns 200 with existing result
 */
import type { FastifyInstance } from 'fastify'
import { settlePayloadSchema } from '../../protocol/x402-schemas.js'
import { settlePaymentUseCase } from '../../application/settle-payment.usecase.js'
import { createSellerRateLimitHook } from '../../infrastructure/rate-limit.js'
import { createError } from '../errors.js'
import { logger } from '../../infrastructure/logger.js'

export async function settleRoute(app: FastifyInstance): Promise<void> {
  // Per-seller rate limit: 30 req/min/seller (keyed by X-Api-Key prefix)
  app.addHook('preHandler', createSellerRateLimitHook('settle'))

  app.post('/settle', async (request, reply) => {
    const parseResult = settlePayloadSchema.safeParse(request.body)
    if (!parseResult.success) {
      throw createError('validation_error', {
        message: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      })
    }

    const { requestId, referralCode } = parseResult.data
    const log = logger.child({ requestId })
    log.info('Settle endpoint called')

    const result = await settlePaymentUseCase(requestId, referralCode)

    const httpStatus = result._idempotent ? 200 : result.settled ? 201 : 422
    return reply.status(httpStatus).send(result)
  })
}
