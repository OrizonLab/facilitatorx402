# Architecture — facilitatorx402

## Vue d'ensemble

```
┌─────────────┐    POST /verify     ┌──────────────────────────────────┐
│   Buyer     │────────────────────▶│                                  │
│  (wallet)   │                     │       facilitatorx402            │
└─────────────┘    POST /settle     │                                  │
       │    ──────────────────────▶│  src/http/routes/                │
       │                            │    verify.route.ts               │
┌─────────────┐                     │    settle.route.ts               │
│   Seller    │◀── 402 / 200 ──────│    receipts.route.ts             │
│  (server)   │                     │    health.route.ts               │
└─────────────┘                     │    metrics.route.ts              │
                                    │    billing.ts                    │
                                    └──────┬─────────────┬────────────┘
                                           │             │
                              ┌────────────▼───┐  ┌─────▼──────────┐
                              │  PostgreSQL     │  │   Redis        │
                              │  (Prisma)       │  │  (ioredis +    │
                              │                 │  │   BullMQ)      │
                              │  payment_       │  │                │
                              │  requests       │  │  settle_lock:* │
                              │  verifications  │  │  queue workers │
                              │  settlements    │  └────────────────┘
                              │  receipts       │
                              └────────────────┘
                                           │
                              ┌────────────▼────────────┐
                              │  Base Mainnet (RPC)      │
                              │  USDC ERC-3009           │
                              │  transferWithAuthorization│
                              └──────────────────────────┘
```

## Modules

| Module | Chemin | Responsabilité |
|--------|--------|----------------|
| **http** | `src/http/` | Routes Fastify, middlewares, error handler, OpenAPI |
| **application** | `src/application/` | Use cases : verify-payment, settle orchestration |
| **protocol** | `src/protocol/` | Parser x402, validation Zod, EIP-712 schema |
| **crypto** | `src/crypto/` | Vérification signature EIP-712 via viem |
| **settlement** | `src/settlement/` | on-chain.ts, fee-engine.ts, referral-service.ts |
| **infrastructure** | `src/infrastructure/` | Config (env), logger (pino), Prisma client, Redis client, NetworkRegistry |

## Flux verify → settle → receipt

```
POST /verify
  │
  ├─ Zod parse payload
  ├─ Check version / network / asset (NetworkRegistry)
  ├─ Check expiresAt > now
  ├─ Check invoiceId binding
  ├─ verifySignature(payload) → viem recoverAddress
  ├─ Check signature_hash UNIQUE (DB)
  ├─ Check nonce UNIQUE (DB)
  ├─ prisma.paymentRequest.create()
  ├─ prisma.paymentVerification.create({ status: 'accepted' })
  └─ return { status: 'accepted', requestId, verificationId }

POST /settle
  │
  ├─ Load paymentRequest (must have accepted verification)
  ├─ Check paymentSettlement.findFirst({ status: 'confirmed' }) → idempotence
  ├─ redis.set(settle_lock:{id}, 'EX 120', 'NX') → lock
  ├─ prisma.paymentSettlement.create({ status: 'pending' })
  ├─ submitOnChain(params) → viem writeContract + waitForTransactionReceipt
  ├─ FeeEngine.compute(amount, seller, referralCode)
  ├─ prisma.$transaction [ update settlement 'confirmed' + create receipt ]
  ├─ redis.del(lock)
  └─ return { settled: true, txHash, receiptId }

GET /receipts/:id
  │
  ├─ prisma.paymentReceipt.findUnique({ id })
  └─ return full receipt payload
```

## Anti-replay

```
  signature_hash ──▶ UNIQUE INDEX payment_verifications(signature_hash)
  nonce          ──▶ UNIQUE INDEX payment_verifications(nonce)
  settlement_id  ──▶ UNIQUE INDEX payment_settlements(settlement_id)
  tx_hash        ──▶ UNIQUE INDEX payment_settlements(tx_hash)
```

## Circuit breaker RPC

```
  RPC primaire (RPC_URL)
      │
      ├─ timeout / erreur ──▶ RPC fallback (RPC_URL_FALLBACK)
      │                            │
      │                            └─ erreur ──▶ throw Error('All RPC endpoints failed')
      │
      └─ succès ──▶ continue
```

Implémentation dans `src/settlement/on-chain.ts` : itération sur `[rpcUrl, fallbackRpcUrl]`.
