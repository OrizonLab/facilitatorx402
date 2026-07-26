# Audit Schéma Prisma — V1

**Date :** 2026-07-26  
**Statut :** Validé  

---

## Résultat de l'audit

Le schéma `prisma/schema.prisma` a été audité vis-à-vis des exigences du plan de développement.

### ✅ Contraintes d'unicité présentes

| Champ | Modèle | Rôle |
|-------|--------|------|
| `signatureHash` | `PaymentVerification` | Anti-replay niveau DB |
| `nonce` | `PaymentVerification` | Anti-replay niveau DB |
| `settlementId` | `PaymentSettlement` | Idempotence settle |
| `txHash` | `PaymentSettlement` | Pas de double tx on-chain |

### ✅ Entités requises

- `PaymentRequest` — seller, buyer, network, asset, amount, invoiceId, scheme, expiresAt
- `PaymentVerification` — requestId, status, errorCode, signatureHash, nonce, payloadHash
- `PaymentSettlement` — requestId, status, txHash, feeAmount, referralCode, developerShare
- `PaymentReceipt` — requestId, protocolVersion, responsePayload
- `AuditLog` — entityType, entityId, action, actor, payload
- `Network` — chainId, name, rpcUrl (pour le seed et la relation DB)

### ✅ Types des montants

Les montants (`amount`, `feeAmount`, `developerShare`) sont en `BigInt` — correct pour USDC 6 decimals et tokens 18 decimals.

### ✅ Seed opérationnel

`prisma/seed.ts` seed le réseau Base (chainId 8453) + asset USDC — cohérent avec ADR-001.

### ⚠️ Points de vigilance pour la Phase 5

1. **Index partiel sur `txHash`** : l'unicité est définie sur la colonne (`@unique`). En PostgreSQL, les valeurs `NULL` multiples sont autorisées sur un `UNIQUE` index — comportement correct pour les settlements en attente. Pas d'action requise.

2. **Rétention** : aucune politique de rétention ou d'archivage définie. À traiter en Phase 5 (`@@index` sur `createdAt` pour faciliter les purges par date).

3. **`responsePayload` en JSON** : flexibilité max pour le reçu. Format précis à figer en Phase 5 lors de l'implémentation de `GET /receipts/:id`.

4. **Partitionnement** : non nécessaire en V1. À réévaluer si volume > 10M lignes/mois (Phase 5 ou post-V1).

---

## Verdict

Le schéma est **validé pour la V1**. Aucune migration corrective requise avant la Phase 4 (settle). La Phase 5 ajoutera les index complémentaires et la politique de rétention.
