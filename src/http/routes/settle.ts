import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { settlePayment } from '../../settlement/settle-payment.js'
import type { SettleDeps } from '../../settlement/settle-payment.js'

const SettleBodySchema = z.object({
  paymentRequestId: z.string().min(1),
  referralCode: z.string().optional(),
})

export async function settleRoute(
  app: FastifyInstance,
  deps: SettleDeps,
): Promise<void> {
  app.post(
    '/settle',
    {
      schema: {
        description: 'Settle a verified x402 payment on-chain',
        tags: ['payments'],
        body: {
          type: 'object',
          required: ['paymentRequestId'],
          properties: {
            paymentRequestId: { type: 'string' },
            referralCode:     { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              settled:      { type: 'boolean' },
              settlementId: { type: 'string' },
              requestId:    { type: 'string' },
              txHash:       { type: 'string' },
              status:       { type: 'string' },
              receiptId:    { type: 'string' },
              _idempotent:  { type: 'boolean' },
            },
          },
          202: {
            type: 'object',
            properties: {
              settled:   { type: 'boolean' },
              requestId: { type: 'string' },
              error: {
                type: 'object',
                properties: {
                  code:    { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = SettleBodySchema.parse(request.body)
      const result = await settlePayment(body, deps)

      if (!result.settled) {
        return reply.status(202).send(result)
      }
      return reply.status(200).send(result)
    },
  )
}
