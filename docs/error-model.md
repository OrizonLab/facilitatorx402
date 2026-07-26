# Error Model — facilitatorx402

## Structure de réponse d'erreur

Tous les endpoints (`POST /verify`, `POST /settle`, etc.) retournent le même
objet d'erreur en cas d'échec :

```json
{
  "status": "rejected",
  "error": {
    "code": "invalid_signature",
    "reason": "Signature does not match the payment payload",
    "message": "The buyer signature could not be verified against the provided payload.",
    "correlationId": "req_01HZ8K3P2X..."
  }
}
```

## Champs

| Champ | Type | Description |
|---|---|---|
| `code` | `string` | Code stable et machine-readable |
| `reason` | `string` | Raison courte lisible |
| `message` | `string` | Message détaillé pour le développeur |
| `correlationId` | `string?` | `requestId` pour le debugging |

## Codes d'erreur

| Code | HTTP | Endpoint | Description |
|---|---|---|---|
| `unsupported_version` | 400 | verify | Version x402 non supportée |
| `unsupported_network` | 400 | verify, settle | Réseau non supporté |
| `unsupported_asset` | 400 | verify, settle | Asset non supporté |
| `expired_payment` | 400 | verify | `expiresAt` dépassé |
| `invalid_signature` | 400 | verify | Signature ECDSA invalide |
| `invalid_nonce` | 400 | verify | Nonce absent ou déjà utilisé |
| `invalid_payload` | 400 | verify, settle | Payload malformé (Zod) |
| `invalid_amount` | 400 | verify | Montant hors limites |
| `invalid_recipient` | 400 | verify | Destinataire ne correspond pas au seller |
| `duplicate_payment` | 409 | verify | `signature_hash` déjà vu |
| `duplicate_settlement` | 409 | settle | `settlement_id` déjà traité |
| `settlement_failed` | 502 | settle | Transaction on-chain revertée |
| `settlement_pending` | 202 | settle | En cours de confirmation |
| `unauthorized` | 401 | tous | API key manquante ou invalide |
| `internal_error` | 500 | tous | Erreur interne non récupérée |

## Règles

- **Codes stables** — jamais renommés une fois en production.
- **Pas de fuite d'info** — les `message` ne contiennent jamais de stack traces, clés privées ou données internes.
- **`correlationId` toujours présent** sur les erreurs 5xx pour traçabilité opérateur.
- **Idempotence** — `duplicate_settlement` (409) n'est pas une erreur, c'est le comportement attendu sur retry.
