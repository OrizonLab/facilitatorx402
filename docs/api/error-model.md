# Error Model — facilitatorx402

> Version : stable V1 — les codes ne changeront pas sans versioning explicite.

---

## Structure de réponse d'erreur

Tous les endpoints retournent les erreurs avec la **même structure** :

```typescript
interface ErrorResponse {
  error: {
    code: string         // Code stable snake_case — ne change jamais
    reason: string       // Description lisible, en anglais
    message: string      // Détail clair pour le développeur
    correlationId?: string  // requestId ou autre identifiant de corrélation
  }
}
```

**Règles d'application :**
- Le `code` est stable dans le temps — **ne jamais modifier un code existant**
- Le `message` peut évoluer entre versions, le `code` ne change pas
- En production, jamais de stack trace ni de message d'erreur interne dans la réponse
- En cas d'`internal_error` : logger l'erreur réelle (pino), retourner un message générique
- Le `correlationId` est toujours présent quand un `requestId` est disponible
- Les erreurs 4xx sont loggées à `warn`, les erreurs 5xx à `error`

---

## Codes d'erreur — POST /verify

| code | HTTP | reason | Déclencheur |
|------|------|--------|-------------|
| `invalid_payload` | 400 | Invalid payload | Zod validation failure, champ manquant ou malformé |
| `unsupported_network` | 402 | Network not supported | `network` non trouvé dans `networkRegistry` |
| `unsupported_asset` | 402 | Asset not supported | `asset` non trouvé sur le réseau |
| `expired_payment` | 402 | Payment proof has expired | `validBefore <= now` |
| `invalid_signature` | 402 | Signature verification failed | `recoverTypedDataAddress` ≠ `authorization.from` |
| `invalid_nonce` | 422 | Nonce already used or invalid | Nonce mal formé (format non-bytes32) |
| `duplicate_payment` | 409 | Payment already processed | Nonce ou `signatureHash` déjà en DB ou Redis |
| `internal_error` | 500 | Internal server error | Erreur non anticipée, DB inaccessible, etc. |

---

## Codes d'erreur — POST /settle

| code | HTTP | reason | Déclencheur |
|------|------|--------|-------------|
| `duplicate_settlement` | 200 | Settlement already completed | `paymentSettlement` existant → réponse idempotente |
| `settlement_pending` | 202 | Settlement already in progress | Lock Redis actif sur le `requestId` |
| `verification_required` | 422 | Payment must be verified first | Aucun `paymentVerification` accepted trouvé |
| `settlement_failed` | 422 | On-chain transaction failed | `revert`, timeout confirmation, erreur RPC définitive |
| `internal_error` | 500 | Internal server error | Erreur non anticipée |

---

## Codes d'erreur — GET /receipts/:id

| code | HTTP | reason | Déclencheur |
|------|------|--------|-------------|
| `not_found` | 404 | Receipt not found | Aucun reçu pour cet `id` |
| `internal_error` | 500 | Internal server error | Erreur non anticipée |

---

## Implémentation

Les codes et la factory `createError()` sont définis dans `src/http/errors.ts`.  
Le handler global Fastify est dans `src/http/error-handler.ts`.

```typescript
// Exemple d'usage dans un use case
import { createError } from '../http/errors.js'

if (auth.validBefore <= nowSec) {
  throw createError('expired_payment', {
    message: `Payment expired at ${new Date(auth.validBefore * 1000).toISOString()}`,
    correlationId: requestId,
  })
}
```

---

## Exemple de réponse — duplicate_payment

```json
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "error": {
    "code": "duplicate_payment",
    "reason": "Payment already processed",
    "message": "Payment already used (nonce already claimed in Redis)",
    "correlationId": "01HX..."
  }
}
```

---

## Exemple de réponse — settlement_failed

```json
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json

{
  "error": {
    "code": "settlement_failed",
    "reason": "On-chain transaction failed",
    "message": "The on-chain transaction was reverted. No funds were moved.",
    "correlationId": "01HX..."
  }
}
```
