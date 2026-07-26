import type { FastifyInstance } from 'fastify'
import { verifyPayment } from '../../application/verify-payment.js'
import type { VerifyDeps } from '../../application/verify-payment.js'

export async function verifyRoute(
  app: FastifyInstance,
  deps: VerifyDeps,
): Promise<void> {
  app.post(
    '/verify',
    {
      schema: {
        description: 'Verify an x402 payment proof',
        tags: ['payments'],
        body: {
          type: 'object',
          required: ['version', 'scheme', 'network', 'asset', 'invoiceId', 'requiredAmount', 'recipient', 'payload'],
          properties: {
            version:        { type: 'string', enum: ['1'] },
            scheme:         { type: 'string', enum: ['exact'] },
            network:        { type: 'string' },
            asset:          { type: 'string' },
            invoiceId:      { type: 'string' },
            requiredAmount: { type: 'string' },
            recipient:      { type: 'string' },
            payload: {
              type: 'object',
              required: ['signature', 'authorization'],
              properties: {
                signature: { type: 'string' },
                authorization: {
                  type: 'object',
                  required: ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'],
                  properties: {
                    from:        { type: 'string' },
                    to:          { type: 'string' },
                    value:       { type: 'string' },
                    validAfter:  { type: 'number' },
                    validBefore: { type: 'number' },
                    nonce:       { type: 'string' },
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
              requestId:        { type: 'string' },
              verificationId:   { type: 'string' },
              paymentRequestId: { type: 'string' },
              status:           { type: 'string', enum: ['accepted'] },
              network:          { type: 'string' },
              asset:            { type: 'string' },
              amount:           { type: 'string' },
              from:             { type: 'string' },
              to:               { type: 'string' },
              invoiceId:        { type: 'string' },
              expiresAt:        { type: 'string', format: 'date-time' },
              verifiedAt:       { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await verifyPayment(request.body, deps)
      return reply.status(200).send(result)
    },
  )
}
