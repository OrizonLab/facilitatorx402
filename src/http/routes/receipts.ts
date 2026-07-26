import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { createError } from '../errors.js'

export async function receiptsRoute(
  app: FastifyInstance,
  prisma: PrismaClient,
): Promise<void> {
  app.get(
    '/receipts/:id',
    {
      schema: {
        description: 'Get a payment receipt by ID',
        tags: ['receipts'],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              receiptId:       { type: 'string' },
              requestId:       { type: 'string' },
              settlementId:    { type: 'string' },
              protocolVersion: { type: 'string' },
              network:         { type: 'object' },
              asset:           { type: 'object' },
              seller:          { type: 'string' },
              buyer:           { type: 'string' },
              amount:          { type: 'string' },
              txHash:          { type: 'string' },
              feeAmount:       { type: 'string' },
              developerShare:  { type: 'string' },
              confirmedAt:     { type: 'string', format: 'date-time' },
              createdAt:       { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      const receipt = await prisma.paymentReceipt.findUnique({
        where: { id },
        include: {
          request: true,
          settlement: true,
        },
      })

      if (!receipt) {
        throw createError('not_found', {
          message: `No receipt found for id: ${id}`,
        })
      }

      const payload = receipt.responsePayload as Record<string, unknown>

      return reply.status(200).send({
        receiptId:       receipt.id,
        requestId:       receipt.requestId,
        settlementId:    receipt.settlementId,
        protocolVersion: receipt.protocolVersion,
        network: {
          name:    payload.network,
          chainId: receipt.request?.network ?? null,
        },
        asset: {
          symbol:  payload.asset,
        },
        seller:        payload.seller,
        buyer:         payload.buyer,
        amount:        payload.amount,
        txHash:        payload.txHash,
        feeAmount:     payload.feeAmount,
        developerShare: payload.developerShare,
        confirmedAt:   payload.confirmedAt,
        createdAt:     receipt.createdAt.toISOString(),
      })
    },
  )
}
