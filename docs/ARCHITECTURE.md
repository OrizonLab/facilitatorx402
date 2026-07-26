# facilitatorx402 — Architecture & Expansion Guide

## Overview

facilitatorx402 is a self-hosted x402 payment facilitator designed to scale from
a simple payment proxy to a full multi-agent, multi-device payment infrastructure.

```
                    ┌───────────────────────┐
                    │  Sellers / Buyers         │
                    │  (servers, robots, IoT,   │
                    │   AI agents, humans)       │
                    └───────────────────────┘
                              │
              REST API  /  SDK  /  MCP
                              │
                    ┌───────┳───────┐
                    │ facilitatorx402 │
                    │  Fastify + Node  │
                    └───────┬───────┘
                            │
          ┌────────────┬─────────────┐
          │           │             │
     PostgreSQL      Redis      Blockchain RPC
     (Prisma)    (BullMQ +      (viem + circuit
                  pub/sub)        breaker)
```

## Module map

```
src/
├── http/                    HTTP layer
│   ├── routes/
│   │   ├── health.route.ts
│   │   ├── supported.route.ts
│   │   ├── verify.route.ts
│   │   ├── settle.route.ts
│   │   ├── receipts.route.ts
│   │   ├── sellers.route.ts     ← API Key + Webhook mgmt
│   │   ├── device-auth.route.ts ← OAuth2 Device Flow (robots)
│   │   ├── sse.route.ts         ← Real-time SSE streaming
│   │   └── mcp.route.ts         ← MCP manifest for AI agents
│   ├── openapi.ts             OpenAPI + Swagger UI
│   └── app.ts
├── application/             Use cases
├── protocol/                x402 parsing
├── crypto/                  Signature verification
├── settlement/              On-chain settlement
├── infrastructure/
│   ├── config.ts
│   ├── db.ts
│   ├── redis.ts
│   ├── logger.ts
│   ├── metrics.ts
│   ├── api-key.ts             ← Key generation + verification
│   ├── webhook-dispatcher.ts  ← HMAC-signed webhook delivery
│   └── network-registry.ts    ← Dynamic multi-network config
└── sdk/
    └── client/                ← @orizonlab/x402-client SDK
        ├── index.ts
        ├── facilitator-client.ts
        ├── facilitator-error.ts
        └── types.ts
```

## Integration patterns by consumer type

### Traditional backend server
```typescript
import { FacilitatorClient } from '@orizonlab/x402-client'
const client = new FacilitatorClient({ url, apiKey })
const { receiptId } = await client.pay(paymentProof)
```

### AI agent (MCP-compatible)
```
GET /.well-known/mcp  → agent discovers tools automatically
Tool: verify_payment + settle_payment
No custom code needed — any MCP-compliant agent works out of the box.
```

### Domestic robot (OAuth2 Device Flow)
```
1. POST /device/authorize  → device_code + user_code displayed on screen
2. User scans QR / enters user_code on phone
3. POST /device/token (poll)  → access_token (API key)
4. Robot uses SDK with { apiKey: access_token }
5. Subscribe to SSE: GET /settlements/:id/stream for instant confirmation
```

### IoT sensor / embedded device
```
Minimal HTTP client — no SDK needed:
POST /verify  { ...proofPayload }
POST /settle  { requestId }
GET  /receipts/:id
```

## Roadmap phases

| Phase | Feature | Status |
|-------|---------|--------|
| 0-8   | Core verify/settle/receipts | ✅ Done |
| 9     | SDK @orizonlab/x402-client | ✅ Done |
| 10    | OpenAPI + /docs | ✅ Done |
| 11    | Webhooks push | ✅ Done |
| 12    | API Key management + seller registration | ✅ Done |
| 13    | Multi-network dynamic registry | ✅ Done |
| 14    | SSE real-time streaming | ✅ Done |
| 15    | MCP manifest for AI agents | ✅ Done |
| 16    | OAuth2 Device Flow for robots | ✅ Done |
| 17    | Redis pub/sub for SSE (worker → HTTP) | 🟡 Next |
| 18    | Prisma migration for sellers + webhooks | 🟡 Next |
| 19    | Admin API (PUT /admin/networks/:chainId) | 🟡 Next |
| 20    | Solana adapter (non-EVM expansion) | 🔵 Future |
