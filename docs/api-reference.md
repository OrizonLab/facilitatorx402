# API Reference — facilitatorx402 v1.0.0

> Base URL: `https://your-facilitator.example.com`  
> Content-Type: `application/json` pour toutes les requêtes

---

## POST /verify

Valide une preuve de paiement x402. Rapide, déterministe, traceable.

### Request

```http
POST /verify
Content-Type: application/json

{
  "version": "1",
  "scheme": "exact",
  "network": "base-mainnet",
  "asset": "USDC",
  "seller": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "buyer": "0xAbCd1234abcd1234abcd1234abcd1234abcd1234",
  "amount": "1000000",
  "invoiceId": "inv_01J5XK2Z3P",
  "expiresAt": "2026-07-26T16:00:00.000Z",
  "nonce": "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  "signature": "0x..."
}
```

### Fields

| Champ | Type | Description |
|-------|------|-------------|
| `version` | string | Version du protocole x402 — `"1"` |
| `scheme` | string | Schéma de paiement — `"exact"` |
| `network` | string | Réseau cible — `"base-mainnet"` |
| `asset` | string | Asset — `"USDC"` |
| `seller` | address | Adresse EVM du destinataire (seller) |
| `buyer` | address | Adresse EVM de l'émetteur (buyer) |
| `amount` | string | Montant en unités USDC (6 décimales) — ex: `"1000000"` = 1 USDC |
| `invoiceId` | string | Identifiant de facture — lié à la ressource protégée |
| `expiresAt` | ISO 8601 | Date d'expiration de la preuve |
| `nonce` | bytes32 | Nonce EIP-712 du buyer — hex 64 chars |
| `signature` | hex | Signature EIP-712 65 bytes du buyer |

### Response 200 — accepted

```json
{
  "status": "accepted",
  "verificationId": "m3x8z2ab-k9p1qrst",
  "requestId": "l4y7a1cd-j8o0mnop",
  "network": "base-mainnet",
  "asset": "USDC",
  "amount": "1000000"
}
```

### Response 200 — rejected

```json
{
  "status": "rejected",
  "error": {
    "code": "expired_payment",
    "reason": "Payment proof has expired",
    "message": "The payment authorization expired at 2026-07-26T15:59:00.000Z",
    "correlationId": "l4y7a1cd-j8o0mnop"
  }
}
```

### Error codes

| Code | HTTP | Description |
|------|------|-------------|
| `unsupported_network` | 200 | Réseau non supporté |
| `unsupported_asset` | 200 | Asset non supporté |
| `expired_payment` | 200 | Preuve expirée (`expiresAt` dépassé) |
| `invalid_signature` | 200 | Signature EIP-712 invalide |
| `invalid_nonce` | 200 | Nonce déjà utilisé (anti-replay) |
| `duplicate_payment` | 200 | `signature_hash` déjà vu (anti-replay) |
| `internal_error` | 500 | Erreur interne — voir logs avec `correlationId` |

---

## POST /settle

Règle la transaction on-chain. Strictement idempotent.

### Request

```http
POST /settle
Content-Type: application/json

{
  "paymentRequestId": "l4y7a1cd-j8o0mnop",
  "referralCode": "PARTNER_XYZ"
}
```

| Champ | Type | Obligatoire | Description |
|-------|------|-------------|-------------|
| `paymentRequestId` | string | ✅ | ID retourné par `/verify` |
| `referralCode` | string | ❌ | Code referral partenaire |

### Response 200 — confirmed

```json
{
  "settled": true,
  "settlementId": "n5z9b3ef-l0q2stuv",
  "requestId": "l4y7a1cd-j8o0mnop",
  "txHash": "0xabc123...",
  "status": "confirmed",
  "receiptId": "o6a0c4fg-m1r3uvwx"
}
```

> Si déjà traité, la même réponse est retournée avec `_idempotent: true`.

### Response 200 — pending (en cours)

```json
{
  "settled": false,
  "requestId": "l4y7a1cd-j8o0mnop",
  "error": {
    "code": "settlement_pending",
    "message": "Settlement already in progress"
  }
}
```

### Error codes

| Code | HTTP | Description |
|------|------|-------------|
| `settlement_failed` | 200 | Transaction on-chain rejetée |
| `settlement_pending` | 200 | Settlement déjà en cours (retry dans 5s) |
| `verification_required` | 400 | Aucune vérification acceptée pour ce `requestId` |
| `internal_error` | 500 | Erreur interne |

---

## GET /supported

Expose la configuration du facilitateur.

### Response

```json
{
  "versions": ["1"],
  "networks": [
    {
      "id": "base-mainnet",
      "chainId": 8453,
      "name": "Base Mainnet"
    }
  ],
  "assets": [
    {
      "symbol": "USDC",
      "network": "base-mainnet",
      "contractAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "decimals": 6
    }
  ],
  "schemes": ["exact"],
  "extensions": [],
  "limits": {
    "minAmount": "100000",
    "maxAmount": "10000000000"
  }
}
```

---

## GET /health

### Response 200 — healthy

```json
{
  "status": "ok",
  "version": "1.0.0",
  "checks": {
    "api": "ok",
    "database": "ok",
    "redis": "ok",
    "rpc": "ok"
  },
  "uptime": 3600
}
```

### Response 503 — degraded

```json
{
  "status": "degraded",
  "version": "1.0.0",
  "checks": {
    "api": "ok",
    "database": "ok",
    "redis": "error",
    "rpc": "ok"
  }
}
```

---

## GET /metrics

Expose les métriques Prometheus (scrape par Prometheus/Grafana).

```
GET /metrics
Accept: text/plain
```

Métriques exposées :

| Métrique | Type | Description |
|----------|------|-------------|
| `x402_verify_duration_seconds` | Histogram | Latence POST /verify (labels: status) |
| `x402_settle_duration_seconds` | Histogram | Latence POST /settle (labels: status) |
| `x402_replay_blocked_total` | Counter | Tentatives de replay bloquées |
| `x402_settlements_total` | Counter | Settlements (labels: status=confirmed\|failed) |
| `x402_fee_collected_total` | Counter | Commission collectée (USDC units) |
| `x402_developer_share_total` | Counter | Part reversée aux développeurs |
| `x402_worker_queue_size` | Gauge | Taille queue BullMQ |

---

## GET /receipts/:id

Retourne le reçu d'un settlement pour audit.

```
GET /receipts/o6a0c4fg-m1r3uvwx
```

### Response 200

```json
{
  "receiptId": "o6a0c4fg-m1r3uvwx",
  "requestId": "l4y7a1cd-j8o0mnop",
  "settlementId": "n5z9b3ef-l0q2stuv",
  "protocolVersion": "1",
  "network": "base-mainnet",
  "asset": "USDC",
  "seller": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "buyer": "0xAbCd1234abcd1234abcd1234abcd1234abcd1234",
  "amount": "1000000",
  "txHash": "0xabc123...",
  "feeAmount": "5000",
  "developerShare": "1000",
  "confirmedAt": "2026-07-26T15:45:00.000Z",
  "createdAt": "2026-07-26T15:44:58.000Z"
}
```

### Response 404

```json
{
  "error": {
    "code": "not_found",
    "message": "Receipt o6a0c4fg-m1r3uvwx not found"
  }
}
```

---

## GET /billing/referral/:code

Stats cumulées d'un referral code (accès opérateur).

```json
{
  "referralCode": "PARTNER_XYZ",
  "totalSettlements": 42,
  "totalGrossVolume": "420000000",
  "totalPlatformFee": "2100000",
  "totalDeveloperShare": "420000",
  "firstUsedAt": "2026-07-01T00:00:00.000Z",
  "lastUsedAt": "2026-07-26T15:30:00.000Z"
}
```

---

## GET /billing/seller/:address

Volume mensuel d'un seller (pour calcul free tier).

```
GET /billing/seller/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045?year=2026&month=7
```

```json
{
  "seller": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "year": 2026,
  "month": 7,
  "monthlyVolumeUnits": "420000000",
  "monthlyVolumeUsdc": "420.000000"
}
```

---

## Error Model

Toutes les erreurs suivent la même structure :

```json
{
  "error": {
    "code": "<stable_code>",
    "reason": "<short human-readable reason>",
    "message": "<detailed message>",
    "correlationId": "<requestId or verificationId>"
  }
}
```

| Code | Stable | Description |
|------|--------|-------------|
| `unsupported_network` | ✅ | Réseau non supporté |
| `unsupported_asset` | ✅ | Asset non supporté |
| `expired_payment` | ✅ | Preuve expirée |
| `invalid_signature` | ✅ | Signature EIP-712 invalide |
| `invalid_nonce` | ✅ | Nonce déjà utilisé |
| `duplicate_payment` | ✅ | signature_hash déjà vu |
| `duplicate_settlement` | ✅ | Settlement déjà confirmé |
| `settlement_failed` | ✅ | Transaction on-chain rejetée |
| `settlement_pending` | ✅ | Settlement en cours |
| `verification_required` | ✅ | Pas de vérification acceptée |
| `not_found` | ✅ | Ressource introuvable |
| `internal_error` | ✅ | Erreur interne — retry safe |
