import { ulid } from 'ulid'
import { prisma } from '../infrastructure/db.js'
import { logger } from '../infrastructure/logger.js'
import { verifyDuration, requestsTotal } from '../infrastructure/metrics.js'
import { validateNetworkAndAsset, validateExpiration, validateAmount } from '../protocol/x402-validator.js'
import { verifySignature, computeSignatureHash, computePayloadHash } from '../crypto/signature-verifier.js'
import { checkAndPersistAntiReplay } from '../crypto/anti-replay.js'
import type { VerifyPayload } from '../protocol/x402-schemas.js'

export interface VerifyResult {
  accepted: true
  requestId: string
  verificationId: string
}

export async function verifyPaymentUseCase(
  payload: VerifyPayload,
  requestId: string,
): Promise<VerifyResult> {
  const end = verifyDuration.startTimer()
  const log = logger.child({ requestId, usecase: 'verify-payment' })

  try {
    log.info({ seller: payload.seller, buyer: payload.buyer, invoiceId: payload.invoiceId }, 'Starting payment verification')

    // 1. Validate network and asset
    validateNetworkAndAsset(payload)

    // 2. Validate expiration
    validateExpiration(payload.expiresAt)

    // 3. Validate amount
    validateAmount(payload.amount)

    // 4. Verify signature
    await verifySignature({
      chainId: payload.network.chainId,
      assetAddress: payload.asset.address,
      amount: payload.amount,
      seller: payload.seller,
      invoiceId: payload.invoiceId,
      expiresAt: payload.expiresAt,
      nonce: payload.nonce,
      signature: payload.signature,
      expectedBuyer: payload.buyer,
    })

    const signatureHash = computeSignatureHash(payload.signature)
    const payloadHash = computePayloadHash(payload)

    // 5. Anti-replay check (before persisting request)
    await checkAndPersistAntiReplay({
      requestId,
      nonce: payload.nonce,
      signatureHash,
      payloadHash,
    })

    // 6. Persist request + verification atomically
    const [, verification] = await prisma.$transaction([
      prisma.paymentRequest.create({
        data: {
          id: requestId,
          seller: payload.seller,
          buyer: payload.buyer,
          network: payload.network.chainId,
          asset: payload.asset.address,
          amount: BigInt(payload.amount),
          invoiceId: payload.invoiceId,
          scheme: payload.scheme,
          expiresAt: new Date(payload.expiresAt),
        },
      }),
      prisma.paymentVerification.create({
        data: {
          id: `ver_${ulid()}`,
          requestId,
          verificationStatus: 'accepted',
          signatureHash,
          nonce: payload.nonce,
          payloadHash,
        },
      }),
    ])

    log.info({ verificationId: verification.id }, 'Payment verification accepted')
    requestsTotal.inc({ endpoint: '/verify', status: 'accepted' })
    end({ status: 'accepted' })

    return {
      accepted: true,
      requestId,
      verificationId: verification.id,
    }
  } catch (err) {
    end({ status: 'rejected' })
    requestsTotal.inc({ endpoint: '/verify', status: 'rejected' })

    // Persist rejection if request doesn't exist yet
    try {
      const exists = await prisma.paymentRequest.findUnique({ where: { id: requestId }, select: { id: true } })
      if (!exists) {
        await prisma.paymentRequest.create({
          data: {
            id: requestId,
            seller: payload.seller,
            buyer: payload.buyer,
            network: payload.network.chainId,
            asset: payload.asset.address,
            amount: BigInt(payload.amount),
            invoiceId: payload.invoiceId,
            scheme: payload.scheme,
            expiresAt: new Date(payload.expiresAt),
          },
        })
      }
    } catch { /* best-effort */ }

    throw err
  }
}
