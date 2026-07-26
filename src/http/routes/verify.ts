/**
 * POST /verify route.
 *
 * Security:
 *   - Per-seller rate limit: 60 req/min via X-Api-Key header (preHandler hook)
 *   - Global IP rate limit applied by @fastify/rate-limit in app.ts
 */
import type { FastifyInstance } from 'fastify'
import { ulid } from 'ulid'
import { verifyPayloadSchema } from '../../protocol/x402-schemas.js'
import { verifyPaymentUseCase } from '../../application/verify-payment.usecase.js'
import { createSellerRateLimitHook } from '../../infrastructure/rate-limit.js'
import { createError } from '../errors.js'
import { logger } from '../../infrastructure/logger.js'

export async function verifyRoute(app: FastifyInstance): Promise<void> {
  // Per-seller rate limit: 60 req/min/seller (keyed by X-Api-Key prefix)
  app.addHook('preHandler', createSellerRateLimitHook('verify'))

  app.post(
    '/verify',
    {},
    async (request, reply) => {
      const requestId = `req_${ulid()}`
      const log = logger.child({ requestId })

      const parseResult = verifyPayloadSchema.safeParse(request.body)
      if (!parseResult.success) {
        throw createError('validation_error', {
          message: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
          correlationId: requestId,
        })
      }

      const result = await verifyPaymentUseCase(parseResult.data, requestId)

      log.info({ verificationId: result.verificationId }, 'Verify endpoint: accepted')
      return reply.status(200).send(result)
    },
  )
}
