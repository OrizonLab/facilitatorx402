# Guide d'intégration seller — facilitatorx402

Ce guide explique comment intégrer facilitatorx402 dans votre service payant, du premier `402` jusqu'à l'accès accordé.

## Vue d'ensemble du flux

```
Votre service                Client               Facilitateur
     │                         │                       │
     │◄── GET /resource ───────│                       │
     │──── 402 + x402 params ─►│                       │
     │                         │──── POST /verify ────►│
     │                         │◄─── 200 accepted ─────│
     │                         │──── POST /settle ────►│
     │                         │◄─── 200 confirmed ────│
     │◄── Webhook: settled ────│                       │
     │──── 200 + resource ────►│                       │
```

## Étape 1 — Créer votre compte seller

```bash
curl -X POST https://your-facilitator.example.com/sellers \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "My API Service",
    "apiKey": "sk_live_your_secure_api_key_here",
    "walletAddress": "0xYourWalletAddressHere"
  }'
```

Réponse :
```json
{
  "id": "seller_01J9XXXXXXXXXX",
  "name": "My API Service",
  "walletAddress": "0xYourWalletAddressHere",
  "active": true,
  "createdAt": "2026-07-26T00:00:00.000Z"
}
```

Conservez votre `apiKey` — elle n'est jamais stockée en clair et ne peut pas être récupérée.

## Étape 2 — Enregistrer votre webhook

```bash
curl -X POST https://your-facilitator.example.com/sellers/seller_01J9XXXXXXXXXX/webhooks \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: sk_live_your_secure_api_key_here' \
  -d '{
    "url": "https://your-service.example.com/webhooks/x402",
    "secret": "whsec_your_webhook_secret_minimum_32_chars",
    "events": ["payment.settled", "payment.failed"]
  }'
```

Événements disponibles :
- `payment.verified` — preuve validée, settlement pas encore soumis
- `payment.settled` — tx confirmée on-chain
- `payment.failed` — settlement échoué

## Étape 3 — Retourner 402 depuis votre service

Quand un client accède à une ressource payante :

```javascript
// Express example
app.get('/api/premium/data', (req, res) => {
  if (!req.headers['x-payment-verified']) {
    return res.status(402).json({
      x402Version: '1',
      accepts: [{
        scheme: 'exact',
        network: 'base-mainnet',
        asset: 'USDC',
        maxAmountRequired: '1000000',  // 1 USDC (6 decimals)
        recipient: '0xYourWalletAddress',
        invoiceId: `inv_${Date.now()}`,
        validFor: 300,  // 5 minutes
        facilitator: 'https://your-facilitator.example.com',
      }],
    })
  }

  // Verify settlement before granting access
  const receiptId = req.headers['x-receipt-id']
  // ... verify receipt via GET /receipts/:id

  return res.json({ data: 'premium content' })
})
```

## Étape 4 — Côté client : verify + settle

```javascript
// Étape A : verify
const verifyRes = await fetch('https://your-facilitator.example.com/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    version: '1',
    scheme: 'exact',
    network: 'base-mainnet',
    asset: 'USDC',
    invoiceId: 'inv_1720000000000',
    requiredAmount: '1000000',
    recipient: '0xYourWalletAddress',
    payload: {
      signature: '0x<eip3009_signature>',
      authorization: {
        from: '0xClientWallet',
        to: '0xYourWalletAddress',
        value: '1000000',
        validAfter: 0,
        validBefore: 1720000300,
        nonce: '0x<random_32_bytes>',
      },
    },
  }),
})

const { requestId, verificationId } = await verifyRes.json()
// verifyRes.status === 200 → accepted

// Étape B : settle
const settleRes = await fetch('https://your-facilitator.example.com/settle', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ requestId, verificationId }),
})

const { receiptId, txHash, status } = await settleRes.json()
// status === 'confirmed' → tx on-chain confirmée

// Étape C : accéder à la ressource avec le receiptId
const resourceRes = await fetch('https://your-service.example.com/api/premium/data', {
  headers: { 'X-Receipt-Id': receiptId },
})
```

## Étape 5 — Vérifier le reçu côté seller

```bash
curl https://your-facilitator.example.com/receipts/01J9RECEIPTID \
  -H 'X-Api-Key: sk_live_your_secure_api_key_here'
```

Réponse :
```json
{
  "receiptId": "01J9RECEIPTID",
  "requestId": "01J9REQUESTID",
  "settlementId": "01J9SETTLEID",
  "status": "confirmed",
  "network": "base-mainnet",
  "asset": "USDC",
  "amount": "1000000",
  "from": "0xClientWallet",
  "to": "0xYourWalletAddress",
  "txHash": "0x<transaction_hash>",
  "feeAmount": "3000",
  "invoiceId": "inv_1720000000000",
  "confirmedAt": "2026-07-26T00:00:05.000Z",
  "createdAt": "2026-07-26T00:00:00.000Z"
}
```

## Étape 6 — Recevoir les webhooks

```javascript
// Express webhook handler
const crypto = require('node:crypto')

app.post('/webhooks/x402', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-facilitator-signature']  // 'sha256=<hex>'
  const timestamp = req.headers['x-facilitator-timestamp']
  const body = req.body.toString()

  // Vérifier la signature HMAC-SHA256
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex')

  if (sig !== expected) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  // Vérifier que le timestamp n'est pas trop vieux (protection replay)
  const age = Date.now() - Number(timestamp)
  if (age > 300_000) {  // 5 minutes max
    return res.status(400).json({ error: 'Webhook too old' })
  }

  const { event, payload } = JSON.parse(body)

  if (event === 'payment.settled') {
    // Accorder l'accès à l'utilisateur
    console.log(`Payment confirmed: ${payload.txHash}`)
  }

  res.status(200).json({ received: true })
})
```

## Gestion des erreurs

| Code HTTP | Code d'erreur | Action recommandée |
|---|---|---|
| 400 | `invalid_payload` | Vérifier le format du payload |
| 402 | `expired_payment` | Demander un nouveau paiement au client |
| 402 | `invalid_signature` | Vérifier la génération de signature EIP-3009 |
| 402 | `unsupported_network` | Vérifier `GET /supported` |
| 409 | `duplicate_payment` | Paiement déjà traité — vérifier le reçu existant |
| 409 | `duplicate_settlement` | Settlement déjà existant — idempotent, récupérer le résultat |
| 429 | `rate_limited` | Implémenter un backoff exponentiel |
| 500 | `internal_error` | Retry avec backoff, contacter le support si persistant |

## Tester en local

```bash
# Démarrer l'infrastructure
docker-compose up -d
npx prisma migrate dev
npm run dev

# Vérifier le health
curl http://localhost:3000/health

# Voir les réseaux supportés
curl http://localhost:3000/supported

# Ouvrir le dashboard opérateur
open http://localhost:3000/dashboard
```

## Support

- Issues GitHub : https://github.com/OrizonLab/facilitatorx402/issues
- Documentation API : `GET /docs` (Swagger UI, dev uniquement)
- Dashboard opérateur : `GET /dashboard`
