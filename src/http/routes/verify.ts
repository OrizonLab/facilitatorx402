import type { FastifyInstance } from 'fastify'
import { ulid } from 'ulid'
import { verifyPayloadSchema } from '../../protocol/x402-schemas.js'
import { verifyPaymentUseCase } from '../../application/verify-payment.usecase.js'
import { createError } from '../errors.js'
import { logger } from '../../infrastructure/logger.js'

export async function verifyRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/verify',
    {
      config: {
        rateLimit: {
          max: app.config?.RATE_LIMIT_VERIFY ?? 100,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const requestId = `req_${ulid()}`
      const log = logger.child({ requestId })

      // Parse and validate body
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
