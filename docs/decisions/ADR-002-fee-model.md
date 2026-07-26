# ADR-002 — Modèle de commission (V1)

**Date :** 2026-07-26  
**Statut :** Accepté  
**Décideurs :** OrizonLab  

---

## Contexte

Le facilitateur génère de la valeur en étant dans le flux de règlement. La V1 doit définir un modèle de commission minimal, opérationnel et extensible pour la Phase 8.

---

## Décision

### Commission plateforme

| Paramètre | Valeur V1 | Variable d'env |
|-----------|-----------|----------------|
| Modèle | Basis points sur montant settled | — |
| Taux standard | **50 bps** (= 0.5%) | `PLATFORM_FEE_BPS=50` |
| Palier gratuit mensuel | Non activé V1 | `FREE_MONTHLY_VOLUME_UNITS=0` |
| Minimum de commission | 0 (pas de minimum absolu) | — |
| Arrondi | Plancher (floor) | — |

**Formule :**
```
fee = floor(amount * PLATFORM_FEE_BPS / 10_000)
```

**Exemple :**
```
amount = 1_000_000 USDC units (= 1.00 USDC, 6 decimals)
PLATFORM_FEE_BPS = 50
fee = floor(1_000_000 × 50 / 10_000) = 5_000 units = 0.005 USDC
```

### Referral code & partage développeur

| Paramètre | Valeur V1 | Variable d'env |
|-----------|-----------|----------------|
| Partage développeur | **20%** de la commission plateforme | `DEVELOPER_SHARE_PERCENT=20` |
| Activation | `referralCode` optionnel dans le payload settle | — |
| Persistance | `payment_settlements.developer_share` (BigInt) | — |
| Reversement V1 | Manuel (script) | — |

**Formule :**
```
developer_share = floor(fee * DEVELOPER_SHARE_PERCENT / 100)
net_platform = fee - developer_share
```

### Offre premium (roadmap Phase 8)

- Taux réduit pour sellers à fort volume (`PREMIUM_FEE_BPS`)
- Palier gratuit mensuel (volume ou nb transactions)
- Tableau de bord apporteur
- Reversement automatique on-chain

---

## Conséquences

- `src/settlement/fee-calculator.ts` : implémenter les formules ci-dessus
- `payment_settlements` : colonnes `fee_amount`, `developer_share`, `referral_code` (déjà dans le schéma)
- `GET /metrics` : métriques `facilitator_commission_total` et `facilitator_developer_share_total`
- Phase 8 uniquement : moteur de paliers, dashboard apporteur, reversement automatique
- **Ne pas implémenter le moteur de paliers avant la validation du flux verify→settle→receipt**
