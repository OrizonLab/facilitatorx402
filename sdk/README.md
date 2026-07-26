# @orizonlab/x402-client

> TypeScript SDK for [facilitatorx402](https://github.com/OrizonLab/facilitatorx402) — the x402 payment facilitator.
> Works in Node.js 18+, Deno, Bun, edge runtimes, and robots running ROS2 / embedded Node.

## Install

```bash
npm install @orizonlab/x402-client
# or
pnpm add @orizonlab/x402-client
```

## Quick start

```typescript
import { FacilitatorClient } from '@orizonlab/x402-client'

const client = new FacilitatorClient({
  url: 'https://facilitator.orizonlab.io',
  apiKey: process.env.FACILITATOR_API_KEY, // optional for public endpoint
})

// One-shot: verify + settle
const { verify, settle } = await client.pay(paymentProof)
console.log('Receipt:', settle.receiptId)

// Or step by step:
const { requestId } = await client.verify(paymentProof)
const result = await client.settle(requestId)
const receipt = await client.getReceipt(result.receiptId)
```

## AI Agent usage (MCP / autonomous agents)

```typescript
// Agent checks facilitator is available before attempting payment
const health = await client.health()
if (health.status !== 'ok') throw new Error('Facilitator unavailable')

// Agent pays for a compute resource
const { settle } = await client.pay(proof)
// Agent polls until confirmed (for environments without webhooks)
const receipt = await client.pollSettlement(settle.receiptId, { intervalMs: 1000, maxAttempts: 60 })
```

## Robot / IoT usage

```typescript
// Minimal footprint — only fetch() required (Node 18+ built-in)
const client = new FacilitatorClient({
  url: process.env.FACILITATOR_URL,
  timeout: 5000,   // fast fail for real-time robot operations
  retries: 3,      // retry on transient network issues
})
```

## Error handling

```typescript
import { FacilitatorAPIError, FacilitatorTimeoutError } from '@orizonlab/x402-client'

try {
  await client.pay(proof)
} catch (err) {
  if (err instanceof FacilitatorAPIError) {
    if (err.isExpired())    console.log('Payment proof expired — generate a new one')
    if (err.isDuplicate())  console.log('Already paid — check receipts')
    if (err.isRetryable())  console.log('Transient error — safe to retry')
    console.log(err.code, err.reason, err.correlationId)
  }
  if (err instanceof FacilitatorTimeoutError) {
    console.log('Facilitator did not respond in time')
  }
}
```

## API Reference

| Method | Description |
|--------|-------------|
| `verify(proof)` | Validate a payment proof. Fast, no on-chain call. |
| `settle(requestId)` | Submit on-chain settlement. Idempotent. |
| `pay(proof)` | One-shot verify + settle. |
| `getReceipt(id)` | Fetch a settlement receipt. |
| `getSupported()` | List supported networks, assets, limits. |
| `health()` | Check facilitator availability. |
| `pollSettlement(id, opts)` | Poll until confirmed/failed (for webhook-less envs). |

## Supported environments

| Runtime | Support |
|---------|---------|
| Node.js 18+ | ✅ Native fetch |
| Node.js 16 | ✅ Pass `node-fetch` via `options.fetch` |
| Deno | ✅ |
| Bun | ✅ |
| Edge (CF Workers, Vercel) | ✅ |
| React Native | ✅ |
| ROS2 (embedded Node) | ✅ |
| Browser | ✅ |
