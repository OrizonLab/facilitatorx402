/**
 * POST /verify
 *
 * Validates an x402 payment proof.
 * Fast, deterministic, and fully traceable.
 *
 * Request body: X402VerifyBodySchema (see x402-parser.ts)
 * Response: VerifyResponse (accepted or rejected)
 *
 * HTTP status codes:
 *   200 — accepted
 *   402 — rejected (invalid, expired, unsupported)
 *   409 — duplicate payment
 *   400 — invalid payload shape
 *   500 — internal error
 */
import type { FastifyInstance } from 'fastify'
import { ulid } from 'ulid'
import { runVerify } from '../../application/verify.service.js'
import { logger } from '../../infrastructure/logger.js'

export async function registerVerifyRoute(app: FastifyInstance): Promise<void> {
  app.post('/verify', {
    schema: {
      tags: ['x402'],
      summary: 'Verify an x402 payment proof',
      description: [
        'Validates an x402 V1 payment payload.',
        '',
        '**Steps performed:**',
        '1. Parse and validate the payload (Zod)',
        '2. Check network & asset are supported',
        '3. Check expiration (validBefore)',
        '4. Check recipient and amount',
        '5. Anti-replay check (Redis + PostgreSQL)',
        '6. Verify EIP-3009 signature (viem)',
        '7. Persist to PostgreSQL',
        '',
        'Returns `status: accepted` or `status: rejected` with a stable error code.',
      ].join('\n'),
      body: {
        type: 'object',
        required: ['version', 'scheme', 'network', 'asset', 'invoiceId', 'requiredAmount', 'recipient', 'payload'],
        properties: {
          version: { type: 'string', example: '1' },
          scheme: { type: 'string', example: 'exact' },
          network: { type: 'string', example: 'base-mainnet' },
          asset: { type: 'string', example: 'USDC' },
          invoiceId: { type: 'string', example: 'inv_01J9XXXXXX' },
          requiredAmount: { type: 'string', example: '1000000' },
          recipient: { type: 'string', example: '0xRecipient...' },
          payload: {
            type: 'object',
            required: ['signature', 'authorization'],
            properties: {
              signature: { type: 'string', example: '0x...' },
              authorization: {
                type: 'object',
                required: ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'],
                properties: {
                  from: { type: 'string' },
                  to: { type: 'string' },
                  value: { type: 'string' },
                  validAfter: { type: 'integer' },
                  validBefore: { type: 'integer' },
                  nonce: { type: 'string' },
                },
              },
            },
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
            status: { type: 'string', enum: ['accepted'] },
            verificationId: { type: 'string' },
            paymentRequestId: { type: 'string' },
            network: { type: 'string' },
            asset: { type: 'string' },
            amount: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            invoiceId: { type: 'string' },
            expiresAt: { type: 'string' },
            verifiedAt: { type: 'string' },
          },
        },
        402: { type: 'object' },
        409: { type: 'object' },
      },
    },
  }, async (request, reply) => {
    const requestId = ulid()

    try {
      const result = await runVerify(request.body, requestId)

      if (result.status === 'rejected') {
        const httpStatus = (result as any).httpStatus ?? 402
        return reply.status(httpStatus).send(result)
      }

      return reply.status(200).send(result)
    } catch (err: any) {
      logger.error({ err, requestId }, 'verify internal error')
      return reply.status(500).send({
        requestId,
        status: 'rejected',
        error: {
          code: 'internal_error',
          message: 'An internal error occurred. Please retry.',
        },
        httpStatus: 500,
        rejectedAt: new Date().toISOString(),
      })
    }
  })
}
