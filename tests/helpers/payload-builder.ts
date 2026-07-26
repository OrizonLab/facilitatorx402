/**
 * Test payload builder — generates valid x402 payloads for tests.
 *
 * Defaults to base-sepolia / USDC with a future validBefore,
 * matching the test environment config.
 *
 * Override any field via the opts parameter.
 */
export interface X402PayloadOverrides {
  nonce?: string
  network?: string
  asset?: string
  value?: string
  requiredAmount?: string
  validBefore?: number
  validAfter?: number
  from?: string
  to?: string
  signature?: string
  invoiceId?: string
  scheme?: string
  version?: string
}

const DEFAULT_FROM = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const DEFAULT_TO = process.env.SELLER_ADDRESS ?? '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const DEFAULT_NETWORK = process.env.SUPPORTED_NETWORK ?? 'base-sepolia'
const DEFAULT_ASSET = process.env.SUPPORTED_ASSET ?? 'USDC'
const DEFAULT_AMOUNT = '1000000' // 1 USDC (6 decimals)
const DEFAULT_SIGNATURE = '0x' + 'ab'.repeat(65) // 65 bytes fake EIP-3009 sig

let counter = 0

export function buildValidX402Payload(opts: X402PayloadOverrides = {}) {
  counter++
  const nowSec = Math.floor(Date.now() / 1000)
  const nonce = opts.nonce ?? `0x${counter.toString(16).padStart(64, '0')}`

  return {
    version: opts.version ?? 'x402-v1',
    scheme: opts.scheme ?? 'eip3009',
    network: opts.network ?? DEFAULT_NETWORK,
    asset: opts.asset ?? DEFAULT_ASSET,
    recipient: opts.to ?? DEFAULT_TO,
    requiredAmount: opts.requiredAmount ?? DEFAULT_AMOUNT,
    invoiceId: opts.invoiceId ?? `inv_test_${counter}_${Date.now()}`,
    payload: {
      authorization: {
        from: opts.from ?? DEFAULT_FROM,
        to: opts.to ?? DEFAULT_TO,
        value: opts.value ?? DEFAULT_AMOUNT,
        validAfter: opts.validAfter ?? nowSec - 60,
        validBefore: opts.validBefore ?? nowSec + 3600,
        nonce,
      },
      signature: opts.signature ?? DEFAULT_SIGNATURE,
    },
  }
}

export function buildExpiredX402Payload(opts: X402PayloadOverrides = {}) {
  return buildValidX402Payload({
    ...opts,
    validBefore: Math.floor(Date.now() / 1000) - 10, // expired 10 seconds ago
    nonce: opts.nonce ?? `0x${'expire' + Date.now().toString(16).padStart(58, '0')}`,
  })
}

export function buildNotYetValidX402Payload(opts: X402PayloadOverrides = {}) {
  const nowSec = Math.floor(Date.now() / 1000)
  return buildValidX402Payload({
    ...opts,
    validAfter: nowSec + 3600, // valid only in 1h
    validBefore: nowSec + 7200,
    nonce: opts.nonce ?? `0x${'future' + Date.now().toString(16).padStart(58, '0')}`,
  })
}
