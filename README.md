# facilitatorx402

A self-hosted x402 payment facilitator — production-ready, written in Node.js 20+, TypeScript, Fastify, Prisma, Redis and viem.

## Overview

facilitatorx402 is a trust layer between a paying service (the seller) and a blockchain network used to settle payments. It implements the [x402 protocol](https://x402.org), handling verification, idempotent settlement, anti-replay protection, receipts and full observability.

**Stack:** Node.js 20 · TypeScript · Fastify · Zod · Prisma · PostgreSQL · Redis · BullMQ · viem · pino · prom-client · Docker · GitHub Actions

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/OrizonLab/facilitatorx402.git
cd facilitatorx402
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your RPC URL, private key and chain config

# 3. Start services
docker-compose -f docker-compose.dev.yml up -d postgres redis

# 4. Run migrations
npm run db:migrate:dev

# 5. Start dev server
npm run dev
```

Or run the full stack with Docker:

```bash
docker-compose up
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/verify` | Verify an x402 payment proof |
| `POST` | `/settle` | Settle a verified payment on-chain |
| `GET` | `/supported` | Supported networks, assets and schemes |
| `GET` | `/health` | Service health (DB, Redis, RPC) |
| `GET` | `/metrics` | Prometheus metrics |
| `GET` | `/receipts/:id` | Get a settlement receipt |

---

## Seller Integration Flow

```
Buyer                   Seller                  Facilitator            Blockchain
  │                       │                          │                      │
  │── GET /resource ──────►│                          │                      │
  │                       │── 402 Payment Required ──►│                      │
  │◄── 402 + invoice ─────│                          │                      │
  │                       │                          │                      │
  │── sign + POST /verify ─────────────────────────►│                      │
  │◄── { accepted: true, requestId } ───────────────│                      │
  │                       │                          │                      │
  │── POST /settle ─────────────────────────────────►│                      │
  │                       │                          │── transfer() ────────►│
  │                       │                          │◄── txHash ────────────│
  │◄── { settled, receiptId } ──────────────────────│                      │
  │                       │                          │                      │
  │── GET /receipts/:id ──────────────────────────►│                      │
  │◄── receipt ─────────────────────────────────────│                      │
```

---

## Error Model

All endpoints return errors in the same structure:

```json
{
  "error": {
    "code": "expired_payment",
    "reason": "Payment proof has expired",
    "message": "The payment proof expired at 2025-01-01T00:00:00Z",
    "correlationId": "req_01HX..."
  }
}
```

### Error Codes

| code | HTTP | when |
|------|------|------|
| `unsupported_network` | 422 | Unknown chainId |
| `unsupported_asset` | 422 | Unknown asset address |
| `expired_payment` | 422 | `expiresAt` passed |
| `invalid_signature` | 422 | Bad signature |
| `invalid_nonce` | 422 | Nonce already used |
| `duplicate_payment` | 409 | Anti-replay blocked |
| `settlement_pending` | 202 | Lock active |
| `duplicate_settlement` | 200 | Idempotent return |
| `settlement_failed` | 422 | On-chain revert |
| `internal_error` | 500 | Unexpected error |

---

## Architecture

```
src/
  http/           # Fastify routes, error handler, app factory
  application/    # Use cases (verify-payment, settle-payment)
  protocol/       # x402 schema validation, network/asset checks
  crypto/         # Signature verification, anti-replay, hashing
  settlement/     # On-chain transfer, fee calculator, worker
  infrastructure/ # Prisma DB, Redis, metrics, logger, config
prisma/           # Schema, migrations, seed
docs/             # API docs, guides, architecture
.github/workflows/ # CI/CD
```

---

## Configuration

All config is loaded from environment variables. See `.env.example` for the full list.

The service **crashes at startup** if any required variable is missing or invalid.

---

## Running Tests

```bash
npm test                 # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage report
```

---

## Roadmap

- [x] Phase 0 — Cadrage
- [x] Phase 1 — Fondations repo
- [x] Phase 2 — Endpoints opérateur
- [x] Phase 3 — Moteur verify
- [x] Phase 4 — Moteur settle
- [x] Phase 5 — Persistance & Audit
- [ ] Phase 6 — Sécurité & Hardening
- [ ] Phase 7 — Intégration seller e2e
- [ ] Phase 8 — Monétisation

---

## License

MIT
