import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { Redis } from 'ioredis'
import type { Logger } from 'pino'
import { parseVerifyRequest, type VerifyRequest } from '../protocol/x402-parser.js'
import { verifyErc3009Signature, computeSignatureHash } from '../crypto/signature-verifier.js'
import { claimNonce, claimSignatureHash, releaseNonce, releaseSignatureHash } from '../infrastructure/anti-replay.js'
import { createError } from '../http/errors.js'

export interface VerifyDeps {
  prisma: PrismaClient
  redis: Redis
  logger: Logger
  networkRegistry: NetworkRegistry
}

export interface NetworkConfig {
  chainId: number
  name: string
  assets: Record<string, AssetConfig>
}

export interface AssetConfig {
  symbol: string
  contractAddress: string  // 0x...
  decimals: number
  eip712Version: string
}

export interface NetworkRegistry {
  getNetwork(name: string): NetworkConfig | undefined
}

export interface VerifyResult {
  requestId: string
  verificationId: string
  paymentRequestId: string
  status: 'accepted'
  network: string
  asset: string
  amount: string
  from: string
  to: string
  invoiceId: string
  expiresAt: string
  verifiedAt: string
}

/**
 * Core verify use case.
 * Validates the x402 payment proof, checks anti-replay, persists result.
 */
export async function verifyPayment(
  rawBody: unknown,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  const { prisma, redis, logger, networkRegistry } = deps

  // 1. Parse + Zod validation
  const parsed = parseVerifyRequest(rawBody)
  if (!parsed.success) {
    throw createError('invalid_payload', {
      message: parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; '),
    })
  }

  const req: VerifyRequest = parsed.data
  const requestId = generateUlid()

  const log = logger.child({ requestId, invoiceId: req.invoiceId })
  log.info({ network: req.network, asset: req.asset }, 'verify.start')

  // 2. Check network support
  const network = networkRegistry.getNetwork(req.network)
  if (!network) {
    throw createError('unsupported_network', {
      message: `Network '${req.network}' is not supported`,
      correlationId: requestId,
    })
  }

  // 3. Check asset support
  const asset = network.assets[req.asset]
  if (!asset) {
    throw createError('unsupported_asset', {
      message: `Asset '${req.asset}' is not supported on network '${req.network}'`,
      correlationId: requestId,
    })
  }

  const auth = req.payload.authorization
  const nowSec = Math.floor(Date.now() / 1000)

  // 4. Check expiration
  if (auth.validBefore <= nowSec) {
    throw createError('expired_payment', {
      message: `Payment expired at ${new Date(auth.validBefore * 1000).toISOString()}`,
      correlationId: requestId,
    })
  }

  // 5. Check recipient binding
  if (auth.to.toLowerCase() !== req.recipient.toLowerCase()) {
    throw createError('invalid_payload', {
      message: `Recipient mismatch: payload.to=${auth.to} != recipient=${req.recipient}`,
      correlationId: requestId,
    })
  }

  // 6. Check amount
  if (BigInt(auth.value) < BigInt(req.requiredAmount)) {
    throw createError('invalid_payload', {
      message: `Amount too low: got ${auth.value}, required ${req.requiredAmount}`,
      correlationId: requestId,
    })
  }

  // 7. Anti-replay — check nonce and signatureHash in Redis BEFORE signature verification
  const signatureHash = computeSignatureHash(req.payload.signature)

  const nonceClaimed = await claimNonce(redis, auth.nonce)
  if (!nonceClaimed) {
    log.warn({ nonce: auth.nonce }, 'verify.replay.nonce')
    throw createError('duplicate_payment', {
      message: 'Payment already used (nonce already claimed)',
      correlationId: requestId,
    })
  }

  const sigClaimed = await claimSignatureHash(redis, signatureHash)
  if (!sigClaimed) {
    // Release nonce to avoid false positives on retry with different nonce
    await releaseNonce(redis, auth.nonce)
    log.warn({ signatureHash }, 'verify.replay.signature')
    throw createError('duplicate_payment', {
      message: 'Payment already used (signature already claimed)',
      correlationId: requestId,
    })
  }

  // 8. Verify EIP-712 signature
  let recoveredAddress: string
  try {
    recoveredAddress = await verifyErc3009Signature({
      authorization: auth,
      signature: req.payload.signature as `0x${string}`,
      contractAddress: asset.contractAddress as `0x${string}`,
      chainId: network.chainId,
      eip712Version: asset.eip712Version,
    })
  } catch (err) {
    // Rollback Redis claims
    await releaseNonce(redis, auth.nonce)
    await releaseSignatureHash(redis, signatureHash)
    log.warn({ err }, 'verify.signature.error')
    throw createError('invalid_signature', {
      message: 'Signature verification failed',
      correlationId: requestId,
    })
  }

  if (recoveredAddress.toLowerCase() !== auth.from.toLowerCase()) {
    await releaseNonce(redis, auth.nonce)
    await releaseSignatureHash(redis, signatureHash)
    log.warn({ recovered: recoveredAddress, from: auth.from }, 'verify.signature.mismatch')
    throw createError('invalid_signature', {
      message: `Signature signer mismatch: recovered ${recoveredAddress}, expected ${auth.from}`,
      correlationId: requestId,
    })
  }

  // 9. Compute payloadHash for audit
  const payloadHash = computePayloadHash(req)

  // 10. Persist — in a transaction: PaymentRequest + PaymentVerification
  const verifiedAt = new Date()
  const expiresAt = new Date(auth.validBefore * 1000)

  try {
    const [paymentRequest, verification] = await prisma.$transaction(async (tx) => {
      const pr = await tx.paymentRequest.create({
        data: {
          id: requestId,
          seller: auth.to,
          buyer: auth.from,
          network: req.network,
          asset: req.asset,
          amount: BigInt(auth.value),
          invoiceId: req.invoiceId,
          scheme: req.scheme,
          expiresAt,
        },
      })

      const verificationId = generateUlid()
      const v = await tx.paymentVerification.create({
        data: {
          id: verificationId,
          requestId: pr.id,
          verificationStatus: 'accepted',
          signatureHash,
          nonce: auth.nonce,
          payloadHash,
        },
      })

      return [pr, v]
    })

    log.info(
      { verificationId: verification.id, paymentRequestId: paymentRequest.id },
      'verify.accepted',
    )

    return {
      requestId,
      verificationId: verification.id,
      paymentRequestId: paymentRequest.id,
      status: 'accepted',
      network: req.network,
      asset: req.asset,
      amount: auth.value,
      from: auth.from,
      to: auth.to,
      invoiceId: req.invoiceId,
      expiresAt: expiresAt.toISOString(),
      verifiedAt: verifiedAt.toISOString(),
    }
  } catch (err) {
    // DB persist failed — rollback Redis claims
    await releaseNonce(redis, auth.nonce)
    await releaseSignatureHash(redis, signatureHash)
    log.error({ err }, 'verify.persist.error')
    throw createError('internal_error', { correlationId: requestId })
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateUlid(): string {
  // Simple timestamp-based ID — replace with `ulid` package if available
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function computePayloadHash(req: VerifyRequest): string {
  const canonical = JSON.stringify({
    version: req.version,
    scheme: req.scheme,
    network: req.network,
    asset: req.asset,
    invoiceId: req.invoiceId,
    requiredAmount: req.requiredAmount,
    recipient: req.recipient.toLowerCase(),
    authorization: {
      from: req.payload.authorization.from.toLowerCase(),
      to: req.payload.authorization.to.toLowerCase(),
      value: req.payload.authorization.value,
      validAfter: req.payload.authorization.validAfter,
      validBefore: req.payload.authorization.validBefore,
      nonce: req.payload.authorization.nonce.toLowerCase(),
    },
    signature: req.payload.signature.toLowerCase(),
  })
  return createHash('sha256').update(canonical).digest('hex')
}
