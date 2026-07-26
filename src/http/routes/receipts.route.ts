/**
 * GET /receipts/:id
 *
 * Returns a structured settlement receipt for audit, support, and seller integration.
 *
 * HTTP status codes:
 *   200 — receipt found
 *   404 — receipt not found
 *   500 — internal error
 */
import type { FastifyInstance } from 'fastify'
import { db } from '../../infrastructure/db.js'
import { logger } from '../../infrastructure/logger.js'

export async function registerReceiptsRoute(app: FastifyInstance): Promise<void> {
  app.get('/receipts/:id', {
    schema: {
      tags: ['x402'],
      summary: 'Get a settlement receipt by ID',
      description: [
        'Returns the full settlement receipt for a given receiptId.',
        '',
        'Receipts are immutable once created. They include:',
        '- Protocol version',
        '- Network and asset',
        '- Gross amount, fee breakdown, net amount',
        '- Transaction hash on-chain',
        '- Confirmation timestamp',
        '- Referral code if present',
      ].join('\n'),
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', example: '01J9RRRRRRRRRRRRRR' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            receiptId:       { type: 'string' },
            requestId:       { type: 'string' },
            protocolVersion: { type: 'string' },
            network:         { type: 'string' },
            asset:           { type: 'string' },
            grossAmount:     { type: 'string' },
            feeAmount:       { type: 'string' },
            developerShare:  { type: 'string' },
            netAmount:       { type: 'string' },
            feeBps:          { type: 'number' },
            txHash:          { type: 'string' },
            referralCode:    { type: 'string', nullable: true },
            confirmedAt:     { type: 'string' },
            createdAt:       { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'object', properties: {
              code:    { type: 'string' },
              message: { type: 'string' },
            }},
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    try {
      const receipt = await db.paymentReceipt.findUnique({
        where: { id },
        include: { request: true },
      })

      if (!receipt) {
        return reply.status(404).send({
          error: { code: 'receipt_not_found', message: `No receipt found with id: ${id}` },
        })
      }

      const payload = receipt.responsePayload as Record<string, unknown>

      return reply.status(200).send({
        receiptId:       receipt.id,
        requestId:       receipt.requestId,
        protocolVersion: receipt.protocolVersion,
        network:         payload['network'] ?? null,
        asset:           receipt.request.asset,
        grossAmount:     payload['grossAmount'] ?? null,
        feeAmount:       payload['feeAmount'] ?? null,
        developerShare:  payload['developerShare'] ?? null,
        netAmount:       payload['netAmount'] ?? null,
        feeBps:          payload['feeBps'] ?? null,
        txHash:          payload['txHash'] ?? null,
        referralCode:    payload['referralCode'] ?? null,
        confirmedAt:     payload['confirmedAt'] ?? null,
        createdAt:       receipt.createdAt.toISOString(),
      })
    } catch (err: any) {
      logger.error({ err, id }, 'receipts internal error')
      return reply.status(500).send({
        error: { code: 'internal_error', message: 'An internal error occurred.' },
      })
    }
  })
}
