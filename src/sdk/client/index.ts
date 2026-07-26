/**
 * @orizonlab/x402-client — TypeScript SDK for the facilitatorx402 API
 *
 * Usable by any seller, AI agent, or autonomous device.
 *
 * @example
 * ```ts
 * import { FacilitatorClient } from '@orizonlab/x402-client'
 *
 * const client = new FacilitatorClient({
 *   url: 'https://facilitator.orizonlab.io',
 *   apiKey: 'fx402_live_...',
 * })
 *
 * const verify = await client.verify(paymentProof)
 * if (verify.status === 'accepted') {
 *   const receipt = await client.settle(verify.requestId)
 * }
 * ```
 */

export { FacilitatorClient } from './facilitator-client.js'
export { FacilitatorError } from './facilitator-error.js'
export type {
  FacilitatorClientOptions,
  VerifyPaymentPayload,
  VerifyResponse,
  SettleResponse,
  SupportedResponse,
  HealthResponse,
  ReceiptResponse,
  WebhookSubscription,
  SellerRegistration,
} from './types.js'
