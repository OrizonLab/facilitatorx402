/**
 * WebhookService — Application layer
 *
 * Responsabilités :
 *   1. Charger la WebhookSubscription du seller depuis la DB
 *   2. Persister chaque tentative dans webhook_deliveries (audit trail)
 *   3. Enqueuer le job BullMQ via enqueueWebhook()
 *
 * Ce service est appelé depuis :
 *   - VerifyService  → après accepted  → event: payment.verified
 *   - SettleService  → après confirmed → event: payment.settled
 *   - SettleService  → après failed    → event: payment.failed
 *
 * Il ne fait PAS la livraison HTTP (c'est le webhook-worker).
 * Il garantit la traçabilité complète des tentatives.
 *
 * @example
 *   await webhookService.notify({
 *     sellerId: 'seller_abc',
 *     event: 'payment.settled',
 *     requestId: 'req_01JX...',
 *     settlementId: 'set_01JX...',
 *     txHash: '0xABC...',
 *     receiptId: 'rec_01JX...',
 *     network: 'base-mainnet',
 *     asset: 'USDC',
 *     amount: '1000000',
 *     feeAmount: '5000',
 *   })
 */
import { prisma } from '../infrastructure/prisma.js'
import { enqueueWebhook, type WebhookEventType, type WebhookPayload } from '../infrastructure/webhook-queue.js'
import { logger } from '../infrastructure/logger.js'

export interface NotifyOptions {
  sellerId: string
  event: WebhookEventType
  requestId: string
  verificationId?: string
  settlementId?: string
  txHash?: string
  receiptId?: string
  network?: string
  asset?: string
  amount?: string
  feeAmount?: string
}

export class WebhookService {
  /**
   * Notify a seller of a payment event.
   * Loads webhook subscription, creates delivery record, enqueues job.
   * Safe to call unconditionally — noop if seller has no active subscription.
   */
  async notify(opts: NotifyOptions): Promise<void> {
    const subscription = await prisma.webhookSubscription.findFirst({
      where: {
        sellerId: opts.sellerId,
        active: true,
        events: { has: opts.event },
      },
    })

    if (!subscription) {
      logger.debug(
        { sellerId: opts.sellerId, event: opts.event },
        'no active webhook subscription for seller + event, skipping'
      )
      return
    }

    const payload: WebhookPayload = {
      event: opts.event,
      requestId: opts.requestId,
      verificationId: opts.verificationId,
      settlementId: opts.settlementId,
      txHash: opts.txHash,
      receiptId: opts.receiptId,
      network: opts.network,
      asset: opts.asset,
      amount: opts.amount,
      feeAmount: opts.feeAmount,
      sellerId: opts.sellerId,
      timestamp: new Date().toISOString(),
    }

    // Persist delivery attempt for audit trail
    const delivery = await prisma.webhookDelivery.create({
      data: {
        subscriptionId: subscription.id,
        event: opts.event,
        payload: payload as any,
        attempt: 1,
        status: 'pending',
      },
    })

    logger.info(
      { deliveryId: delivery.id, sellerId: opts.sellerId, event: opts.event, requestId: opts.requestId },
      'webhook delivery created'
    )

    await enqueueWebhook(opts.sellerId, subscription.url, subscription.secret, payload)
  }
}

export const webhookService = new WebhookService()
