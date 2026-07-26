# facilitatorx402 V2 — Roadmap

V1 est production-ready sur Base mainnet, USDC, mono-réseau.
V2 étend le service sur 4 axes stratégiques.

---

## Axes V2

### Axe 1 — Multi-réseau / multi-asset
Support natif de plusieurs chaînes et assets en parallèle.
- Base mainnet (déjà en V1)
- Optimism mainnet
- Arbitrum One
- Ethereum mainnet (optionnel, gas élevé)
- USDC + EURC sur chaque réseau
- Registry dynamique rechargé sans redémarrage

### Axe 2 — Webhooks seller
Livraison push des événements de settlement vers le seller.
- `payment.verified` → POST /verify accepté
- `payment.settled` → POST /settle confirmé
- `payment.failed` → settlement échoué
- Signature HMAC-SHA256 sur chaque payload
- Retry exponentiel avec dead-letter queue BullMQ
- Dashboard de suivi des livraisons

### Axe 3 — SDK TypeScript
Package npm `@orizonlab/x402-client` pour les sellers.
- `verifyPayment(proof, opts)` → wrapper /verify
- `settlePayment(requestId, verificationId)` → wrapper /settle
- `getReceipt(receiptId)` → wrapper /receipts/:id
- Middleware Express/Fastify/Hono plug-and-play
- Types exportés complets
- Publié sur npm via GitHub Actions

### Axe 4 — Dashboard opérateur
UI web read-only pour monitoring et support.
- Vue en temps réel des settlements (Server-Sent Events)
- Table des paiements avec filtres (réseau, asset, statut, date)
- Détail d’un receipt
- Métriques agregees (volume, commission, taux d’échec)
- Auth basique (DASHBOARD_TOKEN)

---

## Phases V2

| Phase | Contenu | Dépend de |
|---|---|---|
| V2-P1 | Multi-réseau registry dynamique | V1 complet |
| V2-P2 | Multi-asset (EURC + extensible) | V2-P1 |
| V2-P3 | Webhooks seller (BullMQ + HMAC) | V1 complet |
| V2-P4 | SDK TypeScript + middleware | V2-P3 |
| V2-P5 | Dashboard opérateur (SSE + UI) | V2-P3 |
| V2-P6 | Tests intégration multi-réseau | V2-P2 |
| V2-P7 | Monitorin avancé (alertes, SLO) | V2-P5 |

---

## Critère de succès V2

- Un seller peut recevoir des paiements USDC sur Base ET Optimism sans changer son code
- Les webhooks sont livrés avec retry et dead-letter visible
- Le SDK réduit l’intégration à 3 lignes de code
- Le dashboard opérateur permet de diagnostiquer un incident en < 1 minute
