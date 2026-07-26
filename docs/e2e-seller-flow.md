# End-to-End Seller Flow — x402 Facilitator V1

This document describes the complete flow a seller must implement to use the facilitatorx402 service.

---

## Overview

```
Client (buyer)            Seller server             Facilitator (this service)    Base blockchain
     │                        │                              │                         │
     │ GET /premium-content   │                              │                         │
     │───────────────────────>│                              │                         │
     │                        │                              │                         │
     │ 402 Payment Required   │                              │                         │
     │<───────────────────────│  { x402: { ... } }           │                         │
     │                        │                              │                         │
     │ (wallet signs ERC-3009 transferWithAuthorization)     │                         │
     │                        │                              │                         │
     │ POST /premium-content  │                              │                         │
     │  + X-Payment header    │                              │                         │
     │───────────────────────>│                              │                         │
     │                        │ POST /verify                 │                         │
     │                        │─────────────────────────────>│                         │
     │                        │ { status: 'accepted', ... }  │                         │
     │                        │<─────────────────────────────│                         │
     │                        │                              │                         │
     │                        │ POST /settle                 │                         │
     │                        │─────────────────────────────>│                         │
     │                        │                              │ writeContract()         │
     │                        │                              │────────────────────────>│
     │                        │                              │ txHash confirmed        │
     │                        │                              │<────────────────────────│
     │                        │ { status: 'confirmed', ... } │                         │
     │                        │<─────────────────────────────│                         │
     │                        │                              │                         │
     │ 200 OK + content       │                              │                         │
     │<───────────────────────│                              │                         │
     │                        │                              │                         │
     │ GET /receipts/:id      │                              │                         │
     │ (optional audit)       │───────────────────────────────────────────────────────>│
```

---

## Step 1 — Seller returns 402

When a buyer hits a paid endpoint without a valid payment, the seller returns:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": "1",
  "error": "Payment required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-mainnet",
      "maxAmountRequired": "1000000",
      "asset": "USDC",
      "payTo": "0xSELLER_WALLET_ADDRESS",
      "description": "Access to premium report",
      "invoiceId": "inv_abc123",
      "extra": { "timeout": 60 }
    }
  ]
}
```

---

## Step 2 — Client signs and sends X-Payment

The buyer's wallet signs an ERC-3009 `transferWithAuthorization`.
The client re-sends the request with an `X-Payment` header (base64-encoded).

---

## Step 3 — Seller calls POST /verify

### Request

```json
{
  "x402Version": "1",
  "scheme": "exact",
  "network": "base-mainnet",
  "payload": {
    "signature": "0x...",
    "authorization": {
      "from": "0xBUYER_ADDRESS",
      "to": "0xSELLER_WALLET_ADDRESS",
      "value": "1000000",
      "validAfter": "0",
      "validBefore": "1753526400",
      "nonce": "0xRANDOM_32_BYTES"
    }
  },
  "resource": "https://api.seller.com/premium-report",
  "required": {
    "maxAmountRequired": "1000000",
    "asset": "USDC",
    "payTo": "0xSELLER_WALLET_ADDRESS",
    "invoiceId": "inv_abc123",
    "expires": "1753526400"
  }
}
```

### Response (accepted)

```json
{
  "requestId": "01J9XXXXXXXXXXXXXXXXXXX",
  "verificationId": "01J9YYYYYYYYYYYYY",
  "status": "accepted",
  "network": "base-mainnet",
  "asset": "USDC",
  "amount": "1000000",
  "verifiedAt": "2026-07-26T10:42:00.000Z"
}
```

### Response (rejected example)

```json
{
  "requestId": "",
  "status": "rejected",
  "error": {
    "code": "expired_payment",
    "reason": "Payment has expired (validBefore is in the past)",
    "message": "The payment authorization has expired. Please request a new authorization."
  },
  "httpStatus": 402,
  "rejectedAt": "2026-07-26T10:42:01.000Z"
}
```

---

## Step 4 — Seller calls POST /settle

### Request

```json
{
  "requestId": "01J9XXXXXXXXXXXXXXXXXXX",
  "verificationId": "01J9YYYYYYYYYYYYY",
  "referralCode": "PARTNER42"
}
```

### Response (confirmed)

```json
{
  "requestId": "01J9XXXXXXXXXXXXXXXXXXX",
  "status": "confirmed",
  "settlementId": "01J9ZZZZZZZZZZZZZ",
  "txHash": "0xTX_HASH_ON_BASE_MAINNET",
  "feeAmount": "5000",
  "developerShare": "10",
  "receiptId": "01J9RRRRRRRRRRRRRR",
  "confirmedAt": "2026-07-26T10:42:05.000Z",
  "settledAt": "2026-07-26T10:42:05.000Z"
}
```

---

## Step 5 — Seller grants access

Once `/settle` returns `status: confirmed`, the seller can safely grant access to the paid resource.

> **Rule:** Never grant access before a confirmed settlement. A verified payment alone is not sufficient — verification proves intent, settlement proves payment.

---

## Step 6 — Audit via GET /receipts/:id

### Request

```
GET /receipts/01J9RRRRRRRRRRRRRR
```

### Response

```json
{
  "receiptId": "01J9RRRRRRRRRRRRRR",
  "requestId": "01J9XXXXXXXXXXXXXXXXXXX",
  "protocolVersion": "x402-v1",
  "network": "base-mainnet",
  "asset": "USDC",
  "grossAmount": "1000000",
  "feeAmount": "5000",
  "developerShare": "10",
  "netAmount": "995000",
  "feeBps": 50,
  "txHash": "0xTX_HASH_ON_BASE_MAINNET",
  "referralCode": "PARTNER42",
  "confirmedAt": "2026-07-26T10:42:05.000Z",
  "createdAt": "2026-07-26T10:42:05.000Z"
}
```

---

## Key rules for sellers

1. **Always verify before settle.** Do not call `/settle` without a successful `/verify` first.
2. **Settle is idempotent.** Calling `/settle` twice with the same `requestId` is safe — you will get the same result.
3. **Never settle twice.** The same `invoiceId` + `nonce` combination can never be settled more than once.
4. **Grant access only on `status: confirmed`.** `pending` means the settlement is still processing.
5. **Store the `receiptId`.** It is your proof of payment for disputes and support.
6. **Handle `402` on settle.** If settle returns 402, the payment must be restarted from the buyer's side.

---

## Error codes reference

| Code | HTTP | Endpoint | Meaning |
|---|---|---|---|
| `invalid_payload` | 400 | both | Body schema invalid |
| `unsupported_network` | 402 | verify | Network not supported |
| `unsupported_asset` | 402 | verify | Asset not supported |
| `expired_payment` | 402 | verify | Payment authorization expired |
| `invalid_signature` | 402 | verify | EIP-3009 signature invalid |
| `invalid_nonce` | 402 | verify | Nonce format invalid |
| `duplicate_payment` | 409 | verify | Nonce or signature already used |
| `verification_not_found` | 402 | settle | No accepted verification found |
| `settlement_pending` | 409 | settle | Settlement already in progress |
| `settlement_failed` | 402/502 | settle | On-chain submission failed |
| `receipt_not_found` | 404 | receipts | Receipt ID unknown |
| `internal_error` | 500 | both | Unexpected server error |
