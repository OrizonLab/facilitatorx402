import type { FastifyInstance } from 'fastify'
import { prisma } from '../../infrastructure/db.js'
import { createError } from '../errors.js'

export async function receiptsRoute(app: FastifyInstance): Promise<void> {
  app.get('/receipts/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const receipt = await prisma.paymentReceipt.findUnique({
      where: { id },
      include: { request: true },
    })

    if (!receipt) {
      throw createError('not_found', {
        message: `Receipt ${id} not found`,
      })
    }

    return reply.send(receipt.responsePayload)
  })
}
