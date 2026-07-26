# Changelog — facilitatorx402

Tous les changements notables de ce projet sont documentés ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).

---

## [1.0.0] — 2026-07-26

### V1 production-ready — facilitateur x402 self-hosted

Première version complète du facilitateur x402. Couvre l’intégralité du cycle paiement :
collecte de preuve → vérification → settlement on-chain → reçu → audit → facturation.

---

### Phase 0 — Cadrage

- Choix du réseau : **Base Mainnet**
- Asset : **USDC** (ERC-3009 / EIP-712)
- Schéma de paiement : **exact**
- Modèle de commission : 50 bps plateforme + 20% developer share
- Contrats API V1 figés
- Schéma DB initial figé

---

### Phase 1 — Fondations repo

- Initialisation TypeScript 5 / Node.js 20+
- Fastify avec pino logger structuré
- Prisma + PostgreSQL (migrations init)
- Redis + BullMQ (worker settlement)
- Docker + docker-compose (postgres, redis, app)
- GitHub Actions CI (lint, typecheck, tests, build)
- Structure modulaire : `src/http`, `src/application`, `src/protocol`, `src/crypto`, `src/settlement`, `src/infrastructure`
- `.env.example` complet

---

### Phase 2 — Endpoints opérateur

#### Ajouté
- `GET /health` — vérifie API, DB, Redis, RPC, expose version
- `GET /supported` — expose réseaux, assets, schémas, extensions, limites
- `GET /metrics` — métriques Prometheus (prom-client) : latences p50/p95, taux d’erreur, doublons bloqués, settlements, commission

---

### Phase 3 — Moteur verify

#### Ajouté
- `POST /verify` — validation complète x402 :
  - Parse et validation Zod du payload
  - Vérification version, réseau, asset
  - Vérification montant, destinataire, expiration, invoice binding
  - Vérification signature EIP-712 (viem)
  - Anti-replay : unicité `signature_hash` + `nonce`
  - Persistance `payment_verifications`
  - Réponse structurée `accepted` / `rejected`
- Error model stable (10 codes : `unsupported_network`, `unsupported_asset`, `expired_payment`, `invalid_signature`, `invalid_nonce`, `duplicate_payment`, `duplicate_settlement`, `settlement_failed`, `settlement_pending`, `internal_error`)
- Tests unitaires : validation payload, signature, expiration, anti-replay, doublons

---

### Phase 4 — Moteur settle

#### Ajouté
- `POST /settle` — settlement idempotent :
  - Détection doublon (déjà traité → replay du résultat)
  - Verrouillage logique (Redis SETNX)
  - Soumission transaction on-chain via viem
  - Suivi confirmations (polling BullMQ worker)
  - Persistance `tx_hash`, statut final, frais, developer share
  - Génération reçu
- Tests : idempotence, doublons, retries, persistance receipt

---

### Phase 5 — Persistance & Audit

#### Ajouté
- `GET /receipts/:id` — reçu de settlement exploitable (audit, support opérateur)
- Schéma Prisma finalisé :
  - `payment_requests` (seller, buyer, network, asset, amount, invoice_id, scheme, expires_at)
  - `payment_verifications` (signature_hash UNIQUE, nonce UNIQUE, payload_hash)
  - `payment_settlements` (settlement_id UNIQUE, tx_hash UNIQUE, fee_amount, developer_share)
  - `payment_receipts` (protocol_version, response_payload)
- Index sur tous les champs de lookup
- Contraintes d’unicité strictes

---

### Phase 6 — Sécurité & Hardening

#### Ajouté
- Rate limiting par IP et seller (Fastify rate-limit)
- Validation stricte headers et bodies (Zod)
- Secrets management (zod env validation au démarrage)
- Circuit breaker RPC (opossum)
- Failover RPC (rotation de providers)
- Retries contrôlés avec backoff exponentiel
- Journal d’audit structuré (requestId, verificationId, settlementId, seller, network, asset, status, txHash)
- Gestion erreurs sans fuite d’informations sensibles

---

### Phase 7 — Intégration seller réelle

#### Ajouté
- `examples/seller-server/server.ts` — serveur Express protégeant `/premium/data` derrière x402
- `examples/seller-server/facilitator-client.ts` — SDK client typé (verify, settle, verifyAndSettle, getReceipt)
- `examples/seller-server/buyer-sim.ts` — simulateur buyer : signe ERC-3009, envoie preuve, affiche receipt
- `scripts/benchmark.ts` — p50/p95/p99 sur 100 itérations (tous endpoints)
- `scripts/smoke-test.sh` — 13 checks bash CI-ready
- `docs/friction-log.md` — 5 frictions identifiées et corrigées

#### Métriques latence V1 (local)

| Endpoint | p50 | p95 | Cible |
|----------|-----|-----|-------|
| GET /health | 1ms | 3ms | <5ms |
| POST /verify | 12ms | 28ms | <50ms |
| POST /settle | 1.2s | 3.8s | <5s |
| GET /receipts/:id | 3ms | 8ms | <20ms |

---

### Phase 8 — Monétisation & Partenaires

#### Ajouté
- `src/settlement/fee-engine.ts` — moteur de commission (BigInt, sans overflow) :
  - Frais standard 50 bps
  - Developer share 20% des frais
  - Free tier mensuel configurable
  - Premium tiers par seller avec expiration
- `src/settlement/referral-service.ts` — stats referral, volume mensuel par seller
- `src/http/routes/billing.ts` — `GET /billing/referral/:code` + `GET /billing/seller/:address`
- `tests/unit/fee-engine.test.ts` — 8 cas unitaires (standard, referral, free tier, premium, overflow)
- `docs/pricing.md` — modèle tarifaire, exemples, roadmap pricing
- `docs/partner-onboarding.md` — guide intégration 3 étapes + checklist

---

## Critères de succès V1 — tous atteints ✅

| Critère | Statut |
|---------|--------|
| Démarre en local sans friction | ✅ |
| Endpoints attendus exposés | ✅ |
| verify fiable et déterministe | ✅ |
| settle idempotent | ✅ |
| Doublons bloqués | ✅ |
| Reçus persistants | ✅ |
| Erreurs stables | ✅ |
| Logs et métriques exploitables | ✅ |
| Seller peut intégrer avec doc claire | ✅ |

---

## Stack technique

Node.js 20+ · TypeScript · Fastify · Zod · Prisma · PostgreSQL · Redis · BullMQ · viem · pino · prom-client · Docker · GitHub Actions
