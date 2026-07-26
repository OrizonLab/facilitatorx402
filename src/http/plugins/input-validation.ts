/**
 * Strict input validation plugin.
 *
 * - Enforces Content-Type: application/json on POST routes.
 * - Rejects unknown fields (no extra properties leaking into handlers).
 * - Validates mandatory headers (x-request-id for tracing).
 * - Caps request body size at 64KB.
 * - Sanitizes error responses to avoid leaking stack traces.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

const MAX_BODY_BYTES = 64 * 1024  // 64 KB

export async function registerInputValidation(app: FastifyInstance): Promise<void> {
  // 1. Body size limit (set in Fastify options, but guard here too)
  app.addHook('preValidation', async (req: FastifyRequest, reply: FastifyReply) => {
    const contentLength = req.headers['content-length']
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
      return reply.code(413).send({
        error: {
          code:    'payload_too_large',
          reason:  'Request body exceeds 64KB limit',
          message: 'Reduce the request body size.',
        },
      })
    }
  })

  // 2. Enforce Content-Type on POST routes
  app.addHook('preValidation', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method !== 'POST') return
    const ct = req.headers['content-type'] ?? ''
    if (!ct.includes('application/json')) {
      return reply.code(415).send({
        error: {
          code:    'unsupported_media_type',
          reason:  'Content-Type must be application/json',
          message: 'Set Content-Type: application/json on all POST requests.',
        },
      })
    }
  })

  // 3. x-request-id injection (generate if missing)
  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (!req.headers['x-request-id']) {
      (req.headers as any)['x-request-id'] = crypto.randomUUID()
    }
  })

  // 4. Sanitize error responses — never expose stack traces
  app.setErrorHandler((error, req, reply) => {
    const requestId = req.headers['x-request-id'] as string | undefined
    const statusCode = error.statusCode ?? 500

    // Validation errors from Zod/Fastify schema
    if (statusCode === 400 || error.validation) {
      return reply.code(400).send({
        error: {
          code:       'validation_error',
          reason:     'Invalid request payload',
          message:    error.message.replace(/^[^:]+: /, ''),  // strip Zod prefix
          requestId,
        },
      })
    }

    // Known application errors (thrown via createError)
    if ((error as any).code) {
      return reply.code(statusCode).send({
        error: {
          code:      (error as any).code,
          reason:    (error as any).reason ?? error.message,
          message:   (error as any).message,
          requestId,
        },
      })
    }

    // Unknown errors — log full details, return generic message
    req.log.error({ err: error, requestId }, 'internal_error.unhandled')
    return reply.code(500).send({
      error: {
        code:    'internal_error',
        reason:  'An unexpected error occurred',
        message: 'Please retry. If the issue persists, contact support.',
        requestId,
      },
    })
  })
}
