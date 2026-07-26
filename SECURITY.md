# Security Policy — facilitatorx402

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x | ✅ Active security support |
| < 1.0 | ❌ Not supported |

---

## Reporting a Vulnerability

**DO NOT open a public GitHub issue for security vulnerabilities.**

Report privately via GitHub Security Advisories:
1. Go to `https://github.com/OrizonLab/facilitatorx402/security/advisories`
2. Click **"New draft security advisory"**
3. Fill in the details (description, impact, reproduction steps)
4. We will respond within **48 hours**

For critical vulnerabilities (funds at risk), contact the maintainers directly via the email in the GitHub org profile.

---

## Threat Model

### Assets at risk

| Asset | Risk | Mitigated by |
|-------|------|-------------|
| USDC on-chain | Double payment / replay | Anti-replay: `signature_hash` UNIQUE + `nonce` UNIQUE in DB |
| Facilitator private key | Key theft → arbitrary transfers | Key only in env/secrets, never in code or logs |
| Buyer signature | Reuse to drain buyer | `nonce` consumed on first settlement |
| Settlement idempotence | Double settle | Redis SETNX lock + DB idempotence check |
| RPC endpoint | MITM / fake receipt | Only trust tx hash from own node, verify receipt status |

### Out of scope V1
- Buyer wallet compromise (buyer-side risk)
- Smart contract vulnerabilities in USDC/ERC-3009 (Base network risk)
- Physical server access

---

## Security Controls

### Authentication & Authorization
- No public write endpoints without a valid x402 payment proof
- Admin routes (`/admin/*`, `/billing/*`) should be protected by IP allowlist or API key (see `.env.example` → `ADMIN_API_KEY`)
- Rate limiting: 100 req/min per IP on `/verify`, 20 req/min on `/settle` (configurable)

### Input Validation
- All inputs validated by Zod schemas before processing
- Address format enforced: `^0x[0-9a-fA-F]{40}$`
- Amount validated as positive integer (no floats, no negative)
- Expiration validated: `expires_at` must be in the future at time of verify

### Anti-Replay Protection
- `signature_hash`: SHA-256 of the raw EIP-712 signature — UNIQUE constraint in DB
- `nonce`: bytes32 from buyer's EIP-712 nonce — UNIQUE constraint in DB
- Both checked **before** any on-chain submission
- Redis lock ensures no concurrent settlement for the same request

### Secret Management

#### Mandatory secrets (never commit)
```
FACILITATOR_PRIVATE_KEY   — facilitator wallet private key
DATABASE_URL               — PostgreSQL connection string with credentials
REDIS_URL                  — Redis connection string
RPC_URL                    — Primary RPC endpoint (may contain API key)
RPC_URL_FALLBACK            — Fallback RPC
ADMIN_API_KEY              — Admin route protection
```

#### Rotation procedure
1. **FACILITATOR_PRIVATE_KEY**: Create new wallet, transfer remaining funds, update env, redeploy
2. **DATABASE_URL**: Rotate PostgreSQL password in provider dashboard, update env, redeploy
3. **RPC_URL**: Rotate API key in RPC provider dashboard, update env — no downtime (fallback active)
4. **ADMIN_API_KEY**: Generate new key, update env, redeploy, invalidate old key

#### Storage recommendations
- Production: Use a secrets manager (AWS Secrets Manager, HashiCorp Vault, Infisical)
- Never store secrets in `.env` committed to git (`.env` is in `.gitignore`)
- `.env.example` must never contain real values

### Logging
- Logs never include private keys, full signatures, or raw authorization payloads
- Buyer address and seller address are logged (non-sensitive, public on-chain data)
- `pino` redact config should include: `['req.headers.authorization', '*.privateKey', '*.secret']`

### Error Responses
- Error responses never include stack traces in production (`NODE_ENV=production`)
- Error codes are stable and documented — see `docs/api-reference.md`
- No raw database errors exposed to clients

---

## Known Security Considerations

### EIP-712 Domain Version
USDC on Base uses domain version `"2"`. If the domain version is wrong, signature verification will fail with `invalid_signature`. This is by design — an incorrect domain version indicates a misconfigured client, not a security issue.

### `validBefore` Timestamp
The buyer's authorization expires at `validBefore` (Unix seconds). The facilitator must verify this **at time of `/verify`** call. A payment proof received after `validBefore` will be rejected with `expired_payment`.

### Nonce Reuse on Retry
If a buyer retries a failed payment, they **must generate a fresh nonce**. Reusing a nonce from a previous attempt (even a failed one) will trigger `invalid_nonce` (nonce already in DB from the previous attempt). See `docs/friction-log.md` — friction #4.

### Module-Level State (on-chain-transfer.ts)
The old `on-chain-transfer.ts` file used module-level mutable state (`_rpcFailing`, `_circuitOpen`) for the circuit breaker. This is unsafe in multi-instance deployments because each instance has independent state. **This file is deprecated.** The canonical `on-chain.ts` is stateless — failover is handled by iterating RPC URLs, not by shared state.

---

## Security Checklist — Before Production Deployment

- [ ] All secrets in secrets manager, not in `.env` file on disk
- [ ] `NODE_ENV=production` set
- [ ] `ADMIN_API_KEY` set and admin routes protected
- [ ] IP allowlist on `/admin/*` and `/billing/*` routes (nginx/reverse proxy)
- [ ] Rate limiting configured and tested
- [ ] Database not accessible from the public internet
- [ ] Redis not accessible from the public internet
- [ ] Facilitator wallet has only the minimum USDC needed for operations
- [ ] RPC fallback configured and tested
- [ ] Log shipping configured (no raw logs on disk in production)
- [ ] Alerts configured on `settlement_failed` and `internal_error` error codes
