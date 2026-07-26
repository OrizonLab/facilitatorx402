# Runbook Opérateur — facilitatorx402

> Procédures de maintenance, rotation des clés et réponse aux incidents.

---

## Démarrage en local

```bash
# 1. Variables d'environnement (ne jamais committer ce fichier)
cp .env.example .env
# Éditer .env avec les vraies valeurs

# 2. Infrastructure
docker compose up -d

# 3. Migrations
pnpm prisma migrate deploy

# 4. Service
pnpm build && pnpm start

# 5. Healthcheck
curl http://localhost:3000/health
```

---

## Variables d'environnement requises

| Variable | Exemple | Note |
|----------|---------|------|
| `DATABASE_URL` | `postgresql://u:p@db:5432/facilitator` | PostgreSQL |
| `REDIS_URL` | `redis://redis:6379` | Redis |
| `RELAYER_PRIVATE_KEY` | `0x...64hex` | Clé privée du relayer on-chain |
| `RPC_URL` | `https://mainnet.base.org` | RPC principal Base |
| `RPC_URL_FALLBACK` | `https://base.drpc.org` | (Optionnel) RPC failover |
| `SUPPORTED_NETWORK` | `base-mainnet` | Réseau supporté V1 |
| `SUPPORTED_ASSET` | `USDC` | Asset supporté V1 |
| `FEE_BASIS_POINTS` | `50` | Frais plateforme (50 = 0.5%) |
| `DEVELOPER_SHARE_BPS` | `2000` | Part développeur (2000 = 20%) |
| `LOG_LEVEL` | `info` | pino log level |
| `SERVICE_VERSION` | `0.1.0` | Version injectée dans `/health` |

---

## Rotation de la clé relayer

1. Générer une nouvelle clé :
   ```bash
   node -e "console.log(require('viem').generatePrivateKey())"
   ```
2. Mettre à jour `RELAYER_PRIVATE_KEY` dans les secrets (Vault, AWS Secrets Manager, etc.).
3. Redémarrer le service : le nouveau fingerprint est logé au démarrage.
4. Vérifier via `/health` que le service est `healthy`.
5. S'assurer qu'aucun settle `pending` n'était en cours au moment du restart.

---

## Circuit breaker RPC

### État actuel

```bash
curl http://localhost:3000/health | jq '.checks.rpc'
```

```json
{ "status": "healthy", "state": "CLOSED" }
```

### Circuit OPEN — que faire ?

1. Vérifier la disponibilité du RPC primaire.
2. Si `RPC_URL_FALLBACK` est configuré, le failover est automatique.
3. Le circuit passe en `HALF-OPEN` après 30 secondes et sonde le RPC.
4. Forcer une réinitialisation si nécessaire : redémarrer le service.

### Alertes Prometheus à configurer

```yaml
# Exemple alertmanager rules
- alert: RpcCircuitOpen
  expr: facilitator_rpc_circuit_state{rpc="primary"} == 3
  for: 1m
  labels:
    severity: critical
  annotations:
    summary: "RPC circuit breaker OPEN sur le réseau primary"

- alert: SettleFailureRate
  expr: rate(facilitator_settle_total{status="failed"}[5m]) > 0.1
  for: 2m
  labels:
    severity: warning
```

---

## Rate limiting — ajustement

Les limites sont configurées via env ou code (`src/http/plugins/rate-limit.ts`) :

| Route | Limite IP | Limite seller |
|-------|-----------|---------------|
| `POST /verify` | 30 req/min | 60 req/min |
| `POST /settle` | 20 req/min | 40 req/min |
| `GET /receipts/:id` | 60 req/min | — |
| Global | 200 req/min | — |

Pour un seller légitime dépassant les limites, augmenter via un override configurable ou en whitelist Redis.

---

## Métriques Prometheus — dashboard Grafana

### Requêtes Promql utiles

```promql
# Latence p95 verify
histogram_quantile(0.95, rate(facilitator_verify_duration_seconds_bucket[5m]))

# Taux d'erreur settle
rate(facilitator_settle_total{status="failed"}[5m])

# Doublons bloqués
rate(facilitator_verify_duplicates_blocked_total[5m])

# Commission générée (USDC units)
rate(facilitator_fee_collected_total_usdc_units[1h])

# État circuit breaker
facilitator_rpc_circuit_state
```

---

## Incidents types

### settle en boucle `pending`

Cause : lock Redis expiré sans settle confirmé (crash mid-flight).

Résolution :
1. Identifier le `settlementId` en état `pending` dans la DB.
2. Vérifier si le `txHash` existe on-chain.
3. Si confirmé on-chain : mettre manuellement le settlement à `confirmed` et créer le receipt.
4. Si non : supprimer le lock Redis et relancer le settle.

```sql
SELECT id, request_id, settlement_status, tx_hash, created_at
FROM payment_settlements
WHERE settlement_status = 'pending'
  AND created_at < NOW() - INTERVAL '5 minutes';
```

### verify toujours `rejected` sur une signature valide

1. Vérifier le `validBefore` de l'authorization (expiration).
2. Vérifier la version du domaine EIP-712 (USDC Base = version `2`).
3. Vérifier le `chainId` (Base Mainnet = 8453).
4. Vérifier si le nonce a déjà été utilisé (`payment_verifications` table).
