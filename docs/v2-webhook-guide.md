# Webhooks V2 — Guide intégrateur

## Vue d’ensemble

Le facilitatorx402 V2 envoie des webhooks HTTP POST vers l’URL configurée du seller à chaque événement de paiement.

## Événements disponibles

| Événement | Déclencheur |
|---|---|
| `payment.verified` | POST /verify accepté |
| `payment.settled` | POST /settle confirmé |
| `payment.failed` | POST /settle échoué |

## Format du payload

```json
{
  "event": "payment.settled",
  "requestId": "01J9XXXXXXXXXXXXXXXXXXX",
  "verificationId": "01J9YYYYYYYYYYYYY",
  "settlementId": "01J9ZZZZZZZZZZZZZ",
  "txHash": "0xTX_HASH",
  "receiptId": "01J9RRRRRRRRRRRRRR",
  "network": "base-mainnet",
  "asset": "USDC",
  "amount": "1000000",
  "feeAmount": "5000",
  "sellerId": "seller_abc",
  "timestamp": "2026-07-26T10:42:05.000Z"
}
```

## Vérification de signature

Chaque webhook est signé HMAC-SHA256. **Toujours vérifier la signature** avant de traiter l’événement.

```typescript
import { verifyWebhookSignature } from '@orizonlab/x402-client'

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString()
  const signature = req.headers['x-webhook-signature']

  if (!verifyWebhookSignature(rawBody, process.env.WEBHOOK_SECRET, signature)) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const event = JSON.parse(rawBody)
  // Process event...
  res.status(200).json({ received: true })
})
```

## Politique de retry

| Tentative | Délai |
|---|---|
| 1 | immédiate |
| 2 | 2 secondes |
| 3 | 4 secondes |
| 4 | 8 secondes |
| 5 | 16 secondes |
| > 5 | Dead-letter queue |

Les webhooks dead-letterés sont visibles dans le dashboard opérateur.

## Bonnes pratiques

1. **Toujours répondre 200** rapidement (≤ 5s) et traiter l’événement en arrière-plan
2. **Être idempotent** — un même événement peut être livré plusieurs fois
3. **Stocker le `requestId`** comme clé de déduplication
4. **Ne jamais accéder à la ressource** sans avoir reçu `payment.settled`
