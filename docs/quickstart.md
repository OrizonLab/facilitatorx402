# Quickstart — facilitatorx402 V2

Démarrez le service en 5 minutes sur votre machine locale.

---

## Prérequis

- Node.js 20+
- Docker + Docker Compose
- Un wallet EVM avec des fonds pour les frais de transaction

---

## 1. Cloner et configurer

```bash
git clone https://github.com/OrizonLab/facilitatorx402.git
cd facilitatorx402
cp .env.example .env
```

Éditer `.env` et renseigner au minimum :

```env
FACILITATOR_PRIVATE_KEY=0xVOTRE_CLÉ_PRIVÉE
FACILITATOR_WALLET_ADDRESS=0xVOTRE_ADRESSE
DASHBOARD_TOKEN=un-token-secret-ici
```

---

## 2. Démarrer l'infrastructure

```bash
docker-compose up -d
```

Cela démarre PostgreSQL + Redis en arrière-plan.

---

## 3. Migrer la base de données

```bash
npm install
npx prisma migrate dev
npx prisma db seed
```

---

## 4. Démarrer le service

```bash
npm run dev
```

Le service écoute sur `http://localhost:3000`.

---

## 5. Vérifier que tout fonctionne

```bash
curl http://localhost:3000/health
curl http://localhost:3000/supported
```

Réponse attendue de `/health` :

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

## 6. Accéder au dashboard

Ouvrez `http://localhost:3000/dashboard` dans votre navigateur.

Connectez-vous avec le `DASHBOARD_TOKEN` configuré dans votre `.env`.

---

## 7. Créer un seller et configurer un webhook

```bash
# Créer un seller
curl -X POST http://localhost:3000/sellers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mon Service",
    "apiKey": "x402_sk_live_xxxxxxxxxxxxxxxx",
    "walletAddress": "0xYOURWALLET"
  }'

# Enregistrer un webhook
curl -X POST http://localhost:3000/sellers/SELLER_ID/webhooks \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: x402_sk_live_xxxxxxxxxxxxxxxx" \
  -d '{
    "url": "https://votre-service.com/webhooks/x402",
    "secret": "votre-secret-webhook-hmac",
    "events": ["payment.verified", "payment.settled", "payment.failed"]
  }'
```

---

## 8. Flux complet verify → settle

```bash
# 1. Vérifier un paiement
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: x402_sk_live_xxxxxxxxxxxxxxxx" \
  -d @examples/verify-payload.json

# → Réponse : { requestId, verificationId, status: "accepted" }

# 2. Régler le paiement
curl -X POST http://localhost:3000/settle \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: x402_sk_live_xxxxxxxxxxxxxxxx" \
  -d '{ "requestId": "...", "verificationId": "..." }'

# → Réponse : { settlementId, txHash, receiptId, status: "confirmed" }

# 3. Consulter le reçu
curl http://localhost:3000/receipts/RECEIPT_ID
```

---

## 9. Utiliser le SDK TypeScript (recommandé)

```typescript
import { X402Client } from '@orizonlab/x402-client'

const client = new X402Client({
  facilitatorUrl: 'http://localhost:3000',
  sellerId: 'your_seller_id',
  webhookSecret: 'votre-secret-webhook',
})

// Middleware Express — 3 lignes
app.use('/premium', client.expressMiddleware({
  amount: '1000000',  // 1 USDC (6 décimales)
  asset: 'USDC',
  network: 'base-mainnet',
}))
```

---

## Activer Optimism ou Arbitrum

```env
ENABLE_OPTIMISM=true
RPC_URL_OPTIMISM=https://mainnet.optimism.io
```

Puis redémarrer le service. `GET /supported` affichera automatiquement le nouveau réseau.
