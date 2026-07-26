# API Reference — facilitatorx402 V2

Base URL : `http://localhost:3000` (dev) / `https://your-facilitator.com` (prod)

Authentification seller : header `X-Api-Key: <your-api-key>`

---

## POST /verify

Valide une preuve de paiement x402. Vérifie signature, expiration, réseau, asset et anti-replay.

### Request

```http
POST /verify
Content-Type: application/json
X-Api-Key: x402_sk_live_xxx
```

```json
{
  "x402Version": "1",
  "scheme": "exact",
  "network": "base-mainnet",
  "payload": {
    "signature": "0xSIGNATURE",
    "authorization": {
      "from": "0xBUYER",
      "to": "0xSELLER",
      "value": "1000000",
      "validAfter": "0",
      "validBefore": "9999999999",
      "nonce": "0xUNIQUE_NONCE"
    }
  },
  "resource": "https://service.com/premium",
  "required": {
    "maxAmountRequired": "1000000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xSELLER",
    "invoiceId": "inv_20260726_001",
    "expires": "9999999999"
  }
}
```

### Response — accepted

```json
{
  "requestId": "clx1abc...",
  "verificationId": "clx2def...",
  "status": "accepted",
  "network": "base-mainnet",
  "asset": "USDC",
  "amount": "1000000",
  "verifiedAt": "2026-07-26T12:00:00.000Z"
}
```

### Response — rejected

```json
{
  "requestId": "clx1abc...",
  "verificationId": "clx2def...",
  "status": "rejected",
  "error": {
    "code": "invalid_signature",
    "reason": "Signature does not match authorization payload",
    "message": "Payment proof verification failed"
  }
}
```

---

## POST /settle

Règle un paiement vérifié on-chain. **Strictement idempotent** — appeler plusieurs fois avec les mêmes IDs retourne toujours le même résultat.

### Request

```json
{
  "requestId": "clx1abc...",
  "verificationId": "clx2def...",
  "referralCode": "partner_xyz"
}
```

### Response

```json
{
  "requestId": "clx1abc...",
  "settlementId": "clx3ghi...",
  "status": "confirmed",
  "txHash": "0xTRANSACTION_HASH",
  "feeAmount": "5000",
  "developerShare": "1000",
  "receiptId": "clx4jkl...",
  "confirmedAt": "2026-07-26T12:00:05.000Z"
}
```

---

## GET /supported

Retourne les réseaux, assets, schémas et options supportés.

```json
{
  "x402Versions": ["1"],
  "networks": [
    {
      "name": "base-mainnet",
      "chainId": 8453,
      "assets": ["USDC", "EURC"]
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

```json
{
  "status": "ok",
  "version": "2.0.0",
  "database": "ok",
  "redis": "ok",
  "rpc": "ok"
}
```

---

## GET /receipts/:id

Retourne un reçu de settlement complet pour audit.

```json
{
  "receiptId": "clx4jkl...",
  "requestId": "clx1abc...",
  "protocolVersion": "x402-v2",
  "network": "base-mainnet",
  "asset": "USDC",
  "grossAmount": "1000000",
  "feeAmount": "5000",
  "developerShare": "1000",
  "netAmount": "994000",
  "feeBps": 50,
  "txHash": "0xTRANSACTION_HASH",
  "referralCode": "partner_xyz",
  "confirmedAt": "2026-07-26T12:00:05.000Z",
  "createdAt": "2026-07-26T12:00:01.000Z"
}
```

---

## Error Model

Tous les endpoints retournent le même format d'erreur :

```json
{
  "error": {
    "code": "invalid_signature",
    "reason": "Description technique",
    "message": "Message lisible",
    "correlationId": "req_01JX..."
  }
}
```

### Codes d'erreur stables

| Code | HTTP | Description |
|---|---|---|
| `unsupported_network` | 400 | Réseau non supporté |
| `unsupported_asset` | 400 | Asset non supporté sur ce réseau |
| `expired_payment` | 400 | Preuve de paiement expirée |
| `invalid_signature` | 400 | Signature invalide |
| `invalid_nonce` | 400 | Nonce invalide |
| `duplicate_payment` | 409 | Paiement déjà traité (anti-replay) |
| `duplicate_settlement` | 409 | Settlement déjà existant (idempotent) |
| `settlement_failed` | 500 | Échec transaction on-chain |
| `settlement_pending` | 202 | Transaction soumise, confirmation en cours |
| `internal_error` | 500 | Erreur interne |

---

## Dashboard API (V2)

Authentification : `Authorization: Bearer <DASHBOARD_TOKEN>`

| Endpoint | Description |
|---|---|
| `GET /dashboard` | Interface HTML opérateur |
| `GET /dashboard/api/stats` | KPIs agrégées (volume, fees, taux d'échec) |
| `GET /dashboard/api/settlements` | Table paginée `?page=1&limit=20&status=confirmed` |
| `GET /dashboard/api/webhooks` | Table paginée des livraisons webhook |
| `GET /dashboard/events` | SSE stream temps réel |
