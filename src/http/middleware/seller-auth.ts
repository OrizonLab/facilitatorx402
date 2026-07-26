import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../infrastructure/db.js';
import { safeCompare } from '../../infrastructure/safe-compare.js';
import { FacilitatorError } from '../errors.js';
import { logger } from '../../infrastructure/logger.js';

declare module 'fastify' {
  interface FastifyRequest {
    seller?: { id: string; name: string; referralCode: string | null };
  }
}

export async function sellerAuthHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const apiKey = request.headers['x-api-key'];

  if (!apiKey || typeof apiKey !== 'string') {
    throw new FacilitatorError('unauthorized', 'Missing X-Api-Key header', 401);
  }

  const seller = await prisma.seller.findFirst({
    where: { isActive: true },
    select: { id: true, name: true, referralCode: true, apiKeyHash: true },
  });

  if (!seller || !seller.apiKeyHash) {
    throw new FacilitatorError('unauthorized', 'Invalid API key', 401);
  }

  const valid = safeCompare(apiKey, seller.apiKeyHash);
  if (!valid) {
    logger.warn({ sellerId: seller.id }, 'Invalid API key attempt');
    throw new FacilitatorError('unauthorized', 'Invalid API key', 401);
  }

  request.seller = {
    id: seller.id,
    name: seller.name,
    referralCode: seller.referralCode,
  };
}
