# Architecture — facilitatorx402

## Vue d'ensemble

facilitatorx402 est une couche de confiance entre un seller (service payant) et le réseau blockchain utilisé pour régler les paiements.

```
┌──────────────────────────────────────────────────────────────────────┐
│                         SELLER SERVICE                               │
│   1. GET /resource → 402 Payment Required (avec x402 parameters)     │
│   2. Client envoie POST /verify au facilitateur                      │
│   3. POST /settle → tx on-chain                                      │
│   4. Seller accorde l'accès sur reçu de settlement                   │
└──────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      FACILITATORX402                                 │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │
│  │ /verify  │  │ /settle  │  │/receipts │  │ /health          │    │
│  │          │  │          │  │/:id      │  │ /supported       │    │
│  │ Fastify  │  │ Fastify  │  │          │  │ /metrics         │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────────────┘    │
│       │             │             │                                  │
│       ▼             ▼             ▼                                  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   Application Layer                          │   │
│  │  verify.service  │  settle.service  │  webhook.service       │   │
│  └──────────┬────────────────┬─────────────────┬───────────────┘   │
│             │                │                 │                    │
│       ┌─────▼──────┐  ┌──────▼──────┐  ┌───────▼──────┐           │
│       │  Protocol  │  │  Settlement │  │  BullMQ      │           │
│       │  x402      │  │  viem       │  │  webhook     │           │
│       │  parser    │  │  on-chain   │  │  queue       │           │
│       └─────┬──────┘  └──────┬──────┘  └───────┬──────┘           │
│             │                │                 │                    │
│       ┌─────▼────────────────▼─────────────────▼──────┐            │
│       │              Infrastructure                    │            │
│       │  PostgreSQL  │  Redis  │  pino  │  Prometheus  │            │
│       └────────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────────────┘
```

## Flux complet — verify → settle → receipt

```
Client                 Seller              Facilitateur           Blockchain
  │                     │                      │                      │
  │─── GET /resource ──►│                      │                      │
  │                     │──── 402 + params ───►│                      │
  │                     │                      │                      │
  │────── POST /verify ─────────────────────►  │                      │
  │                     │           parse + validate payload          │
  │                     │           anti-replay check (Redis + PG)    │
  │                     │           verify EIP-3009 signature         │
  │                     │           persist payment_verification      │
  │◄─── 200 accepted ───────────────────────── │                      │
  │                     │                      │                      │
  │────── POST /settle ─────────────────────►  │                      │
  │                     │           check idempotence                 │
  │                     │           lock (Redis SETNX)                │
  │                     │           ──── transferWithAuthorization ──►│
  │                     │           wait confirmation (30s timeout)   │
  │                     │           persist settlement + receipt      │
  │                     │           fire webhook payment.settled      │
  │◄─── 200 confirmed ──────────────────────── │                      │
  │                     │                      │                      │
  │─── GET /receipts/id ────────────────────►  │                      │
  │◄─── receipt JSON ───────────────────────── │                      │
  │                     │                      │                      │
  │─── accès accordé ──►│                      │                      │
```

## Modules

### `src/http`
Couche transport. Routes Fastify, schemas Zod, error handler, OpenAPI.

### `src/application`
Cas d'usage métier. `verify.service`, `settle.service`, `webhook.service`, `seller.service`. Aucune dépendance directe vers Fastify.

### `src/protocol`
Parser x402, validateur, types. Décodage du payload, vérification de version, schéma.

### `src/crypto`
Vérification de signature EIP-3009 via viem. Isolation cryptographique testable indépendamment.

### `src/settlement`
Soumission on-chain via viem. Circuit breaker, retry, failover RPC.

### `src/infrastructure`
Dépendances externes : Prisma, Redis, BullMQ, pino, Prometheus, config.

### `src/infrastructure/workers`
Workers BullMQ : `settlement.worker.ts` (tx on-chain), `webhook.worker.ts` (livraison HTTP).

## Décisions techniques

### Pourquoi Fastify ?
Fastify est 2-3× plus rapide qu'Express pour les I/O intensifs. Schéma JSON natif (ajv), plugins TypeScript-first, et serialization rapide.

### Pourquoi viem ?
viem est tree-shakeable, TypeScript-first, et préféré à ethers v5 pour les nouvelles intégrations. L'ABI `transferWithAuthorization` est codée statiquement dans `src/settlement`.

### Pourquoi BullMQ ?
Les settlements on-chain peuvent prendre 30s+. BullMQ permet :
- retry automatique avec backoff exponentiel
- jobs persistés dans Redis (survie aux redémarrages)
- concurrence contrôlée
- visibilité dans Bull Board

### Pourquoi Prisma ?
Migrations typées, client TypeScript généré, `prisma studio` pour l'inspection. Les contraintes d'unicité (signature_hash, nonce, tx_hash) sont définies au niveau DB + Prisma.

### Anti-replay à deux niveaux
1. **Redis** : `SET nonce:<value> 1 EX 3600 NX` — vérification rapide en mémoire
2. **PostgreSQL** : contrainte `UNIQUE(nonce)` et `UNIQUE(signature_hash)` — garantie durée de vie

### Idempotence sur /settle
1. Vérification DB : `findUnique({ where: { requestId } })` — retourne immédiatement si existe
2. Verrou Redis : `SET lock:settle:<requestId> 1 EX 60 NX` — bloque les appels concurrents
3. Résultat identique garanti : même input → même output, toujours

## Structure du schéma DB

```
payment_requests
  └── payment_verifications (1:N)
        └── payment_settlements (1:1)
              └── payment_receipts (1:1)

sellers
  └── webhook_subscriptions (1:1)
        └── webhook_deliveries (1:N)
```

## Variables d'environnement critiques

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `WALLET_PRIVATE_KEY` | Clé de signature des tx on-chain |
| `SUPPORTED_NETWORK` | Réseau V1 (ex: `base-mainnet`) |
| `SUPPORTED_ASSET` | Asset V1 (ex: `USDC`) |
| `PLATFORM_FEE_BPS` | Commission en basis points (ex: `30` = 0.3%) |
| `DASHBOARD_TOKEN` | Token d'accès au dashboard opérateur |

Voir `.env.example` pour la liste complète.
