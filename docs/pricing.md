# Pricing — facilitatorx402

> Modèle économique V1. Tous les montants en USDC (6 décimales).

---

## Frais de plateforme

Le facilitateur prélève une commission sur chaque settlement confirmé.

| Tier | Volume mensuel | Taux | Note |
|------|----------------|------|------|
| **Standard** | Tout volume | **0.50%** (50 bps) | Taux par défaut |
| **Free tier** | < seuil configuré | **0%** | Optionnel, configurable par opérateur |
| **Premium** | Sur demande | Réduit (ex. 10 bps) | Négocié avec le partenaire |

### Exemple

```
Paiement buyer : 10.00 USDC (10_000_000 units)
Frais standard : 0.05 USDC (50_000 units — 0.5%)
Net seller     : 9.95 USDC
```

---

## Programme referral

Tout développeur ou partenaire qui intègre le facilitateur peut obtenir un `referralCode`.

| Paramètre | Valeur V1 |
|-----------|----------|
| Part du développeur | **20%** des frais plateforme |
| Calcul | `developerShare = platformFee × 20%` |
| Reversement | Tracké en DB, future API de reversement |

### Exemple avec referral

```
Paiement buyer : 10.00 USDC
Frais plateforme : 0.05 USDC
Part développeur (20%) : 0.01 USDC → reversé au partenaire
Retenu plateforme  : 0.04 USDC
```

---

## API billing (opérateur)

### Stats referral

```
GET /billing/referral/:code

{
  "referralCode": "PARTNER_XYZ",
  "totalSettlements": 42,
  "totalGrossVolume": "420000000",
  "totalPlatformFee": "2100000",
  "totalDeveloperShare": "420000",
  "firstUsedAt": "2026-07-01T00:00:00.000Z",
  "lastUsedAt": "2026-07-26T15:30:00.000Z"
}
```

### Volume mensuel seller

```
GET /billing/seller/0xSELLER?year=2026&month=7

{
  "seller": "0xd8dA...",
  "year": 2026,
  "month": 7,
  "monthlyVolumeUnits": "420000000",
  "monthlyVolumeUsdc": "420.000000"
}
```

---

## Roadmap pricing

| Version | Feature |
|---------|---------|
| V1 | Frais standard 50 bps, referral 20%, free tier optionnel |
| V1.1 | Premium tiers par seller (négocié) |
| V1.2 | API de reversement automatique developer share |
| V2 | Abonnement mensuel fixe + frais réduits |
| V2+ | Marketplace partenaires, SLA garantis |
