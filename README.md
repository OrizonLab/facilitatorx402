# facilitatorx402

[![CI](https://github.com/OrizonLab/facilitatorx402/actions/workflows/ci.yml/badge.svg)](https://github.com/OrizonLab/facilitatorx402/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

**facilitatorx402** est un facilitateur de paiement x402 self-hosted — une couche de confiance entre votre service payant et le réseau blockchain utilisé pour régler les paiements.

> Mono-réseau · mono-asset · mono-schéma · production-ready V1

## Démarrage en 60 secondes

```bash
git clone https://github.com/OrizonLab/facilitatorx402.git
cd facilitatorx402
cp .env.example .env          # adapter DATABASE_URL, REDIS_URL, WALLET_PRIVATE_KEY
docker-compose up -d           # PostgreSQL + Redis
npx prisma migrate dev         # migrations
npm install && npm run dev     # démarrage
curl http://localhost:3000/health
```

## Endpoints

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/verify` | Valide une preuve de paiement x402 |
| `POST` | `/settle` | Règle la transaction on-chain (idempotent) |
| `GET` | `/receipts/:id` | Reçu de règlement pour audit |
| `GET` | `/supported` | Réseaux, assets, schémas supportés |
| `GET` | `/health` | Statut API, DB, Redis, RPC |
| `GET` | `/metrics` | Métriques Prometheus |
| `POST` | `/sellers` | Créer un compte seller |
| `POST` | `/sellers/:id/webhooks` | Enregistrer un webhook |
| `GET` | `/dashboard` | Dashboard opérateur UI |
| `GET` | `/dashboard/events` | Stream SSE temps réel |

## Flux de paiement

```
Client → POST /verify → POST /settle → GET /receipts/:id → accès accordé
```

Voir [docs/seller-integration.md](docs/seller-integration.md) pour le guide complet.

## Stack

Node.js 20+ · TypeScript · Fastify · Zod · Prisma · PostgreSQL · Redis · BullMQ · viem · pino · prom-client

## Documentation

| Document | Contenu |
|---|---|
| [docs/quickstart.md](docs/quickstart.md) | Setup de 0 à intégration |
| [docs/api-reference.md](docs/api-reference.md) | Référence complète des endpoints |
| [docs/seller-integration.md](docs/seller-integration.md) | Guide intégration seller step-by-step |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Diagrammes, décisions techniques |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | Conventions, workflow, tests |

## Configuration

Toutes les variables sont dans `.env.example`. Aucun secret dans le code.

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/facilitatorx402
REDIS_URL=redis://localhost:6379
WALLET_PRIVATE_KEY=0x...       # clé de signature des tx on-chain
SUPPORTED_NETWORK=base-mainnet
SUPPORTED_ASSET=USDC
PLATFORM_FEE_BPS=30            # 0.3% de commission
DASHBOARD_TOKEN=...            # accès dashboard opérateur
```

## Tests

```bash
npm test              # tous les tests
npm run test:coverage # rapport de couverture
```

## Licence

MIT — voir [LICENSE](LICENSE)
