/** Types partagés du protocole x402 — source de vérité unique */

export const X402_VERSION = '1.0' as const;
export const SUPPORTED_SCHEMES = ['eip155'] as const;
export const SUPPORTED_VERSIONS = [X402_VERSION] as const;

export type X402Version = typeof SUPPORTED_VERSIONS[number];
export type X402Scheme = typeof SUPPORTED_SCHEMES[number];

export interface X402PaymentPayload {
  version: string;
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  seller: string;
  buyer: string;
  invoiceId: string;
  nonce: string;
  expiresAt: string; // ISO 8601
  signature: string;
}

export interface X402VerifyResult {
  status: 'accepted' | 'rejected';
  verificationId?: string;
  errorCode?: string;
  reason?: string;
  message?: string;
  correlationId?: string;
}

export interface X402SettleResult {
  status: 'confirmed' | 'failed' | 'pending';
  settlementId?: string;
  txHash?: string;
  confirmedAt?: string;
  feeAmount?: string;
  developerShare?: string;
  receiptId?: string;
  errorCode?: string;
  reason?: string;
  message?: string;
  correlationId?: string;
}

export interface PaymentProof {
  payload: X402PaymentPayload;
  signatureHash: string;
  payloadHash: string;
}

export const ErrorCodes = {
  UNSUPPORTED_VERSION: 'unsupported_version',
  UNSUPPORTED_NETWORK: 'unsupported_network',
  UNSUPPORTED_ASSET: 'unsupported_asset',
  EXPIRED_PAYMENT: 'expired_payment',
  INVALID_SIGNATURE: 'invalid_signature',
  INVALID_NONCE: 'invalid_nonce',
  DUPLICATE_PAYMENT: 'duplicate_payment',
  DUPLICATE_SETTLEMENT: 'duplicate_settlement',
  SETTLEMENT_FAILED: 'settlement_failed',
  SETTLEMENT_PENDING: 'settlement_pending',
  INTERNAL_ERROR: 'internal_error',
  UNAUTHORIZED: 'unauthorized',
  INVALID_PAYLOAD: 'invalid_payload',
  INVALID_AMOUNT: 'invalid_amount',
  INVALID_RECIPIENT: 'invalid_recipient',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
