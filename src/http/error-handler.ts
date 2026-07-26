import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { FacilitatorError, toErrorResponse } from './errors.js'
import { logger } from '../infrastructure/logger.js'
import { errorsTotal } from '../infrastructure/metrics.js'

export function errorHandler(
  error: FastifyError | FacilitatorError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const requestId = request.id as string

  if (error instanceof FacilitatorError) {
    const statusCode = error.httpStatus

    if (statusCode >= 500) {
      logger.error({ requestId, code: error.code, err: error }, 'Facilitator error')
    } else {
      logger.warn({ requestId, code: error.code, err: error.message }, 'Facilitator error')
    }

    errorsTotal.inc({ endpoint: request.routerPath ?? 'unknown', code: error.code })

    void reply.status(statusCode).send(toErrorResponse(error))
    return
  }

  // Fastify validation error
  if ('validation' in error && error.validation) {
    logger.warn({ requestId, err: error.message }, 'Validation error')
    void reply.status(400).send({
      error: {
        code: 'validation_error',
        reason: 'Request validation failed',
        message: error.message,
        correlationId: requestId,
      },
    })
    return
  }

  // Unknown error — never leak details
  logger.error({ requestId, err: error }, 'Unhandled error')
  errorsTotal.inc({ endpoint: request.routerPath ?? 'unknown', code: 'internal_error' })

  void reply.status(500).send({
    error: {
      code: 'internal_error',
      reason: 'Internal server error',
      message: 'An unexpected error occurred',
      correlationId: requestId,
    },
  })
}
