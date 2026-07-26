# Exemple Seller End-to-End — facilitatorx402

> Flux complet : 402 → verify → settle → receipt

---

## Vue d'ensemble

```
Client (buyer)          Seller Server           Facilitator x402           Base Mainnet
      |                      |                         |                        |
      |  GET /resource        |                         |                        |
      |--------------------> |                         |                        |
      |  402 Payment Required |                         |                        |
      | <-------------------- |                         |                        |
      |                      |                         |                        |
      | (buyer signs ERC-3009 off-chain)                |                        |
      |                      |                         |                        |
      |  POST /verify ------->|                         |                        |
      |                      |----POST /verify-------> |                        |
      |                      |   (x402 payload)        |                        |
      |                      |                         | validate + anti-replay |
      |                      | <--- 200 accepted ------ |                        |
      |                      |                         |                        |
      |                      |----POST /settle-------> |                        |
      |                      |   (paymentRequestId)    |                        |
      |                      |                         |--TransferWithAuth----> |
      |                      |                         | <--- txHash confirmed - |
      |                      | <--- 200 confirmed ----- |                        |
      |                      |                         |                        |
      |  200 OK + resource   |                         |                        |
      | <-------------------- |                         |                        |
      |                      |                         |                        |
      |  GET /receipts/:id -->|                         |                        |
      |                      |----GET /receipts/:id--> |                        |
      |                      | <--- receipt JSON ------- |                        |
```

---

## Étape 1 — Le seller retourne 402

Lorsque le buyer accède à une ressource protégée sans paiement, le seller retourne :

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
x-payment-required: version=1

{
  "version": "1",
  "scheme": "exact",
  "network": "base-mainnet",
  "asset": "USDC",
  "invoiceId": "inv_api_call_abc123",
  "requiredAmount": "1000000",
  "recipient": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "description": "API call: GET /premium/data"
}
```

---

## Étape 2 — Le buyer signe off-chain

Le buyer signe une `TransferWithAuthorization` ERC-3009 avec son wallet (EIP-712) :

```typescript
const authorization = {
  from:        '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',  // buyer
  to:          '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',  // seller
  value:       BigInt('1000000'),   // 1.00 USDC
  validAfter:  BigInt(0),
  validBefore: BigInt(Math.floor(Date.now() / 1000) + 300), // +5 minutes
  nonce:       '0x' + crypto.randomBytes(32).toString('hex'),
}

// Signature via wallet (EIP-712, domain version '2' pour USDC Base)
const signature = await walletClient.signTypedData({ ... })
```

---

## Étape 3 — POST /verify

### Requête

```json
POST /verify
Content-Type: application/json

{
  "version": "1",
  "scheme": "exact",
  "network": "base-mainnet",
  "asset": "USDC",
  "invoiceId": "inv_api_call_abc123",
  "requiredAmount": "1000000",
  "recipient": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "payload": {
    "signature": "0x1b2c3d...(65 bytes)",
    "authorization": {
      "from":        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "to":          "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      "value":       "1000000",
      "validAfter":  0,
      "validBefore": 1753574400,
      "nonce":       "0xabc123...64hex"
    }
  }
}
```

### Réponse (200)

```json
{
  "requestId":        "lkj38z-x4f2ab1c",
  "verificationId":   "lkj38z-y7g3cd2e",
  "paymentRequestId": "lkj38z-x4f2ab1c",
  "status":           "accepted",
  "network":          "base-mainnet",
  "asset":            "USDC",
  "amount":           "1000000",
  "from":             "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "to":               "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "invoiceId":        "inv_api_call_abc123",
  "expiresAt":        "2026-07-26T18:00:00.000Z",
  "verifiedAt":       "2026-07-26T17:55:00.000Z"
}
```

---

## Étape 4 — POST /settle

### Requête

```json
POST /settle
Content-Type: application/json

{
  "paymentRequestId": "lkj38z-x4f2ab1c",
  "referralCode": "PARTNER_XYZ"  // optionnel
}
```

### Réponse (200)

```json
{
  "settled":      true,
  "settlementId": "lkj38z-z9h4ef3g",
  "requestId":    "lkj38z-x4f2ab1c",
  "txHash":       "0x4a5b6c7d...",
  "status":       "confirmed",
  "receiptId":    "lkj38z-w2k5gh4h"
}
```

---

## Étape 5 — Le seller accorde l'accès

```typescript
// Seller middleware (exemple Express/Fastify)
async function requirePayment(req, res, next) {
  const body = req.body  // x402 payload envoyé par le buyer

  const verifyRes = await fetch('http://facilitator/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!verifyRes.ok) return res.status(402).json(await verifyRes.json())

  const { paymentRequestId } = await verifyRes.json()

  const settleRes = await fetch('http://facilitator/settle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentRequestId }),
  })

  const settle = await settleRes.json()
  if (!settle.settled) return res.status(402).json(settle)

  req.receiptId = settle.receiptId
  next()
}
```

---

## Étape 6 — GET /receipts/:id

```json
GET /receipts/lkj38z-w2k5gh4h

{
  "receiptId":       "lkj38z-w2k5gh4h",
  "requestId":       "lkj38z-x4f2ab1c",
  "settlementId":    "lkj38z-z9h4ef3g",
  "protocolVersion": "1",
  "network":         { "name": "base-mainnet", "chainId": "8453" },
  "asset":           { "symbol": "USDC" },
  "seller":          "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "buyer":           "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "amount":          "1000000",
  "txHash":          "0x4a5b6c7d...",
  "feeAmount":       "5000",
  "developerShare":  "1000",
  "referralCode":    "PARTNER_XYZ",
  "confirmedAt":     "2026-07-26T17:55:05.000Z",
  "createdAt":       "2026-07-26T17:55:05.000Z"
}
```

---

## Résumé du flux pour les développeurs

1. **Le seller expose une ressource protégée** — retourne `402` avec les paramètres de paiement
2. **Le buyer signe off-chain** — aucune transaction blockchain à ce stade, juste une signature EIP-712
3. **Le seller appelle `POST /verify`** — le facilitateur valide la preuve (signature, expiration, anti-replay)
4. **Le seller appelle `POST /settle`** — le facilitateur soumet la transaction on-chain et attend la confirmation
5. **Le seller accorde l'accès** — la transaction est confirmée, `settled: true`
6. **Le reçu est consultable** via `GET /receipts/:id` pour audit, support et comptabilité

**Propriétés clés :**
- Si `POST /settle` est appelé deux fois avec le même `paymentRequestId`, le deuxième retourne `_idempotent: true` sans nouvelle transaction
- Si la signature est rejouée, `POST /verify` retourne `duplicate_payment` (409)
- Le reçu est persistant et consultable à tout moment après le settlement
