# Onboarding Partenaires — facilitatorx402

> Guide d’intégration pour les développeurs et partenaires seller.

---

## Prérequis

- Un wallet EVM (seller address)
- Des USDC sur Base Mainnet (ou Base Sepolia pour les tests)
- Node.js 20+

---

## Intégration en 3 étapes

### Étape 1 — Obtenir votre referral code

Contactez l'équipe OrizonLab pour recevoir un `referralCode` personnel.
Ce code vous permettra de toucher 20% des frais générés par vos intégrations.

### Étape 2 — Installer le SDK

```bash
# Le SDK est le fichier examples/seller-server/facilitator-client.ts
# Copier dans votre projet ou publier en npm (roadmap V1.1)
cp examples/seller-server/facilitator-client.ts src/lib/facilitator-client.ts
```

Variables d’environnement requises :

```bash
export FACILITATOR_URL=https://facilitator.orizonlab.io  # URL de l'instance
```

### Étape 3 — Protéger votre premier endpoint

```typescript
import { verifyAndSettle } from './facilitator-client.js'

// Middleware Fastify
async function requirePayment(req, reply) {
  const proof = JSON.parse(req.headers['x-payment-proof'] ?? 'null')
  if (!proof) {
    return reply.status(402).send({
      version:        '1',
      scheme:         'exact',
      network:        'base-mainnet',
      asset:          'USDC',
      invoiceId:      `inv_${Date.now()}`,
      requiredAmount: '1000000',  // 1 USDC
      recipient:      process.env.SELLER_ADDRESS!,
    })
  }

  const result = await verifyAndSettle(proof, 'VOTRE_REFERRAL_CODE')
  if (!result.settled) return reply.status(402).send({ error: 'payment_failed' })

  req.receiptId = result.receiptId
}
```

---

## Tester en local

```bash
# 1. Cloner le repo
git clone https://github.com/OrizonLab/facilitatorx402
cd facilitatorx402

# 2. Copier et éditer les variables
cp .env.example .env

# 3. Démarrer l'infrastructure
docker compose up -d

# 4. Migrations + service
pnpm prisma migrate deploy
pnpm build && pnpm start

# 5. Vérification rapide
bash scripts/smoke-test.sh

# 6. Simuler un buyer
SELLER_URL=http://localhost:3001 \
BUYER_PRIVATE_KEY=0x... \
pnpm ts-node examples/seller-server/buyer-sim.ts
```

---

## Checklist intégration

- [ ] `FACILITATOR_URL` configuré
- [ ] `SELLER_ADDRESS` configuré (wallet qui reçoit les USDC)
- [ ] Middleware `requirePayment` intégré
- [ ] `referralCode` ajouté dans les appels `settlePayment`
- [ ] Retry 202 implémenté (voir `docs/friction-log.md` #3)
- [ ] Nonce frais généré à chaque nouvelle tentative (voir friction #4)
- [ ] `GET /receipts/:id` appelé pour audit et support

---

## Support

- Issues : [github.com/OrizonLab/facilitatorx402/issues](https://github.com/OrizonLab/facilitatorx402/issues)
- Docs : `docs/seller-e2e.md`, `docs/runbook.md`, `docs/pricing.md`
- Friction log : `docs/friction-log.md`
