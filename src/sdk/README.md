# @orizonlab/x402-client

TypeScript SDK for the [facilitatorx402](https://github.com/OrizonLab/facilitatorx402) API.

Usable by any seller, AI agent, or autonomous device (robots, IoT).

## Install

```bash
npm install @orizonlab/x402-client
```

## Quick start

```typescript
import { FacilitatorClient } from '@orizonlab/x402-client'

const client = new FacilitatorClient({
  url: 'https://facilitator.orizonlab.io',
  apiKey: 'fx402_live_...', // optional for public endpoints
})

// Check if the facilitator is live
const health = await client.health()
console.log(health.status) // 'ok'

// Verify a payment proof received from a buyer
const verify = await client.verify(paymentProof)
if (verify.status === 'accepted') {
  // Settle the payment on-chain
  const settle = await client.settle(verify.requestId)
  console.log(settle.txHash) // '0xabc...'

  // Get the audit receipt
  const receipt = await client.getReceipt(settle.receiptId!)
}
```

## One-call payment (AI agents & robots)

```typescript
// Verify + settle in one atomic call
const { receiptId, txHash } = await client.pay(paymentProof)
```

## Device registration (robots & IoT)

Autonomous devices that cannot manage Ethereum private keys directly
can use the custodial wallet approach:

```typescript
// Register a device once — returns a managed wallet + API key
const seller = await client.registerSeller({
  name: 'Home Robot v2',
  deviceType: 'robot',  // 'server' | 'robot' | 'iot' | 'agent'
  webhookUrl: 'https://my-robot-gateway.local/x402/events',
})

console.log(seller.apiKey)        // 'fx402_live_...'
console.log(seller.walletAddress) // '0xabc...' (managed by facilitator)
```

## Webhooks (push notifications)

Critical for devices that cannot poll for payment status:

```typescript
// Subscribe to settlement events
await client.createWebhook({
  url: 'https://my-service.example.com/x402/events',
  events: ['settlement.confirmed', 'settlement.failed'],
})
```

## Error handling

```typescript
import { FacilitatorClient, FacilitatorError } from '@orizonlab/x402-client'

try {
  await client.settle(requestId)
} catch (err) {
  if (err instanceof FacilitatorError) {
    console.error(err.code)           // 'duplicate_settlement'
    console.error(err.reason)         // 'Payment already settled'
    console.error(err.correlationId)  // for support
  }
}
```

## All error codes

| Code | Description |
|---|---|
| `unsupported_network` | Chain ID not supported |
| `unsupported_asset` | Token address not supported |
| `expired_payment` | Payment proof has expired |
| `invalid_signature` | EIP-191 signature mismatch |
| `invalid_nonce` | Nonce already used |
| `duplicate_payment` | Same signature hash already verified |
| `duplicate_settlement` | Payment already settled |
| `settlement_failed` | On-chain transaction failed |
| `settlement_pending` | Transaction submitted but not yet confirmed |
| `internal_error` | Transient server error (retried automatically) |

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | required | Facilitator base URL |
| `apiKey` | `string` | optional | Bearer token for seller endpoints |
| `timeoutMs` | `number` | `10000` | Per-request timeout |
| `maxRetries` | `number` | `3` | Retries on transient errors |
| `userAgent` | `string` | SDK version | Identifies your service in logs |
