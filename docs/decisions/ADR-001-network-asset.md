# ADR-001 — Réseau et Asset cibles (V1)

**Date :** 2026-07-26  
**Statut :** Accepté  
**Décideurs :** OrizonLab  

---

## Contexte

La V1 du facilitateur x402 doit démarrer sur un seul réseau avec un seul asset pour réduire la surface de risque et valider le flux end-to-end avant de multiplier les intégrations.

---

## Décision

### Réseau principal

| Paramètre | Valeur |
|-----------|--------|
| Nom | Base Mainnet |
| Chain ID | `8453` |
| RPC primaire | `https://mainnet.base.org` (configurable via `RPC_URL_BASE`) |
| RPC fallback | configurable via `RPC_URL_BASE_FALLBACK` |
| Explorateur | https://basescan.org |
| Support viem | ✅ `import { base } from 'viem/chains'` |

**Raisons :**
- Frais de transaction ultra-faibles (< 0.01$)
- USDC natif déployé par Circle (ERC-3009 / EIP-712 v2)
- Finality rapide (~2s)
- Écosystème x402 déjà actif sur Base
- Support viem natif

### Asset principal

| Paramètre | Valeur |
|-----------|--------|
| Symbole | `USDC` |
| Adresse contrat | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Decimals | `6` |
| Standard | ERC-20 + ERC-3009 (TransferWithAuthorization) |
| EIP-712 domain version | `2` |
| Émetteur | Circle |

**Raisons :**
- Stablecoin USD de référence, liquidité maximale
- ERC-3009 natif → signature off-chain + transfert gasless pour le payer
- EIP-712 domain version `2` documentée et stable
- Pas d'exposition à la volatilité pour le seller

### Schéma de paiement

| Paramètre | Valeur |
|-----------|--------|
| Schéma V1 | `exact` |
| Version protocole | `1` |
| Mécanisme | `TransferWithAuthorization` (ERC-3009) |
| Invoice binding | `invoiceId` unique par `paymentRequest` |

### Confirmations requises

| Paramètre | Valeur |
|-----------|--------|
| Confirmations minimales | `1` (configurable `REQUIRED_CONFIRMATIONS`) |
| Timeout confirmation | `120s` (configurable `CONFIRMATION_TIMEOUT_MS`) |

---

## Réseaux V2 prévus (roadmap)

`network-registry.ts` est déjà multi-réseau. Les prochains réseaux activables via env vars :
- **Optimism** (`ENABLE_OPTIMISM=true`) — USDC `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85`
- **Arbitrum One** (`ENABLE_ARBITRUM=true`) — USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- **EURC** sur Base — déjà configuré dans le registry, désactivé en V1

---

## Conséquences

- `src/infrastructure/network-registry.ts` : Base activé par défaut, Optimism/Arbitrum via env
- `prisma/seed.ts` : seed le réseau Base + asset USDC
- `GET /supported` : expose Base/USDC uniquement en V1
- Tests : tous les fixtures utilisent `chainId: 8453` et l'adresse USDC Base
- Signature verifier : `eip712Version: '2'` sur l'asset USDC Base
