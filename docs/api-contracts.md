# Contrats API V1 — facilitatorx402

> Version : `1.0.0`  
> Protocole : x402 v1  
> Réseau : Base Mainnet (chainId 8453)  
> Asset : USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)

Ce document est la référence figée des contrats API V1. Les codes d'erreur et les structures de réponse sont **stables** — ils ne changeront pas sans versioning.

---

## Structure commune

Tous les endpoints retournent du JSON avec `Content-Type: application/json`.

### Réponse d'erreur (tous endpoints)

```typescript
interface ErrorResponse {
  error: {
    code: string        // Code stable snake_case
    reason: string      // Description lisible
    message: string     // Détail développeur
    correlationId?: string  // requestId si disponible
  }
}
```

---

## POST /verify

### Requête

```typescript
interface VerifyRequest {
  version: '1'
  scheme: 'exact'
  network: string           // 'base-mainnet'
  asset: string             // 'USDC'
  invoiceId: string         // Identifiant unique de la facture
  requiredAmount: string    // Montant en unités (BigInt string)
  recipient: string         // Adresse destinataire attendue (0x...)
  payload: {
    signature: string       // EIP-712 signature (0x... 65 bytes)
    authorization: {
      from: string          // Adresse payeur (0x...)
      to: string            // Adresse destinataire (0x...)
      value: string         // Montant en unités
      validAfter: number    // Unix timestamp
      validBefore: number   // Unix timestamp (expiration)
      nonce: string         // 32 bytes hex (0x...)
    }
  }
}
```

### Réponse acceptée — HTTP 200

```json
{
  "requestId": "01HX...",
  "status": "accepted",
  "verificationId": "01HX...",
  "paymentRequestId": "01HX...",
  "network": "base-mainnet",
  "asset": "USDC",
  "amount": "1000000",
  "from": "0xBUYER...",
  "to": "0xSELLER...",
  "invoiceId": "inv_abc123",
  "expiresAt": "2026-01-01T00:05:00Z",
  "verifiedAt": "2026-01-01T00:00:00Z"
}
```

### Réponse rejetée — HTTP 402 / 409

```json
{
  "requestId": "01HX...",
  "status": "rejected",
  "error": {
    "code": "expired_payment",
    "message": "Payment expired at 2026-01-01T00:04:00Z"
  },
  "httpStatus": 402,
  "rejectedAt": "2026-01-01T00:05:01Z"
}
```

### Codes d'erreur verify

| code | HTTP | description |
|------|------|-------------|
| `invalid_payload` | 400 | Payload malformé ou champ manquant |
| `unsupported_network` | 402 | Réseau non supporté |
| `unsupported_asset` | 402 | Asset non supporté |
| `expired_payment` | 402 | Preuve expirée (`validBefore` dépassé) |
| `invalid_signature` | 402 | Signature EIP-712 invalide |
| `duplicate_payment` | 409 | Nonce ou signature déjà utilisé |
| `internal_error` | 500 | Erreur interne (détail masqué en prod) |

---

## POST /settle

### Requête

```typescript
interface SettleRequest {
  paymentRequestId: string  // ID retourné par /verify
  referralCode?: string     // Code apporteur optionnel
}
```

### Réponse settled — HTTP 200

```json
{
  "settled": true,
  "settlementId": "set_01HX...",
  "requestId": "req_01HX...",
  "txHash": "0xabc...",
  "status": "confirmed",
  "receiptId": "rec_01HX..."
}
```

### Réponse idempotente — HTTP 200

```json
{
  "settled": true,
  "settlementId": "set_01HX...",
  "requestId": "req_01HX...",
  "txHash": "0xabc...",
  "status": "confirmed",
  "receiptId": "rec_01HX...",
  "_idempotent": true
}
```

### Réponse en cours — HTTP 202

```json
{
  "settled": false,
  "requestId": "req_01HX...",
  "error": {
    "code": "settlement_pending",
    "message": "Settlement already in progress"
  }
}
```

### Codes d'erreur settle

| code | HTTP | description |
|------|------|-------------|
| `duplicate_settlement` | 200 | Déjà réglé — réponse idempotente |
| `settlement_pending` | 202 | En cours de traitement |
| `verification_required` | 422 | Vérification préalable manquante |
| `settlement_failed` | 422 | Transaction revertée ou timeout |
| `internal_error` | 500 | Erreur interne |

---

## GET /supported

### Réponse — HTTP 200

```json
{
  "x402Versions": ["1"],
  "networks": [
    {
      "name": "base-mainnet",
      "chainId": 8453,
      "assets": ["USDC"]
    }
  ],
  "schemes": ["exact"],
  "extensions": [],
  "settlementOptions": {
    "feeModel": "basis_points",
    "feeBps": 50,
    "referralCodeSupported": true
  }
}
```

---

## GET /health

### Réponse OK — HTTP 200

```json
{
  "status": "ok",
  "version": "1.0.0",
  "checks": {
    "database": "ok",
    "redis": "ok",
    "worker": "ok",
    "rpc": "ok"
  },
  "timestamp": "2026-01-01T00:00:00Z"
}
```

### Réponse dégradée — HTTP 503

```json
{
  "status": "degraded",
  "version": "1.0.0",
  "checks": {
    "database": "ok",
    "redis": "error",
    "worker": "unknown",
    "rpc": "ok"
  },
  "timestamp": "2026-01-01T00:00:00Z"
}
```

---

## GET /metrics

Format Prometheus text/plain. `Content-Type: text/plain; version=0.0.4`

Métriques exposées :

```
facilitator_verify_duration_seconds{quantile="0.5"}
facilitator_verify_duration_seconds{quantile="0.95"}
facilitator_settle_duration_seconds{quantile="0.5"}
facilitator_settle_duration_seconds{quantile="0.95"}
facilitator_requests_total{endpoint, status}
facilitator_errors_total{endpoint, code}
facilitator_duplicate_blocked_total
facilitator_settlements_total{status}
facilitator_commission_total_units
facilitator_developer_share_total_units
facilitator_worker_queue_depth
facilitator_worker_active_jobs
```

---

## GET /receipts/:id

### Réponse — HTTP 200

```json
{
  "receiptId": "rec_01HX...",
  "requestId": "req_01HX...",
  "protocolVersion": "1",
  "network": {
    "name": "base-mainnet",
    "chainId": 8453
  },
  "asset": {
    "symbol": "USDC",
    "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  },
  "seller": "0xSELLER...",
  "buyer": "0xBUYER...",
  "amount": "1000000",
  "txHash": "0xabc...",
  "feeAmount": "5000",
  "developerShare": "1000",
  "confirmedAt": "2026-01-01T00:01:00Z",
  "createdAt": "2026-01-01T00:00:00Z"
}
```

### Erreur non trouvé — HTTP 404

```json
{
  "error": {
    "code": "not_found",
    "reason": "Receipt not found",
    "message": "No receipt found for id: rec_01HX..."
  }
}
```
