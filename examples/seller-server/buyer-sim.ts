/**
 * Buyer simulator — Phase 7
 *
 * Simulates a buyer completing the full x402 payment flow:
 *   1. GET /premium/data → receives 402
 *   2. Signs ERC-3009 authorization off-chain
 *   3. Retries with x-payment-proof header
 *   4. Receives 200 + receiptId
 *
 * Usage:
 *   SELLER_URL=http://localhost:3001 \
 *   BUYER_PRIVATE_KEY=0x... \
 *   pnpm ts-node examples/seller-server/buyer-sim.ts
 */
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { createWalletClient, createPublicClient, http, parseUnits } from 'viem'
import { base } from 'viem/chains'
import crypto from 'node:crypto'

const SELLER_URL        = process.env.SELLER_URL        ?? 'http://localhost:3001'
const BUYER_PRIVATE_KEY = (process.env.BUYER_PRIVATE_KEY ?? generatePrivateKey()) as `0x${string}`
const RPC_URL           = process.env.RPC_URL           ?? 'https://mainnet.base.org'

// EIP-712 domain for USDC on Base (version '2')
const USDC_DOMAIN = {
  name:              'USD Coin',
  version:           '2',
  chainId:           8453,
  verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
}

const TRANSFER_WITH_AUTHORIZATION_TYPE = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
}

async function run() {
  const account      = privateKeyToAccount(BUYER_PRIVATE_KEY)
  const walletClient = createWalletClient({ account, chain: base, transport: http(RPC_URL) })

  console.log(`[buyer] Address: ${account.address}`)
  console.log(`[buyer] Seller:  ${SELLER_URL}`)

  // Step 1: probe the resource → expect 402
  const probe = await fetch(`${SELLER_URL}/premium/data`)
  if (probe.status !== 402) {
    console.error('[buyer] Expected 402, got', probe.status)
    process.exit(1)
  }

  const requirement = await probe.json() as any
  console.log('[buyer] Received 402:', JSON.stringify(requirement, null, 2))

  // Step 2: sign ERC-3009 authorization
  const nonce: `0x${string}` = ('0x' + crypto.randomBytes(32).toString('hex')) as `0x${string}`
  const now = Math.floor(Date.now() / 1000)

  const authorization = {
    from:        account.address,
    to:          requirement.recipient as `0x${string}`,
    value:       BigInt(requirement.requiredAmount),
    validAfter:  BigInt(0),
    validBefore: BigInt(now + 300),  // 5 min window
    nonce,
  }

  const signature = await walletClient.signTypedData({
    domain: USDC_DOMAIN,
    types:  TRANSFER_WITH_AUTHORIZATION_TYPE,
    primaryType: 'TransferWithAuthorization',
    message: {
      ...authorization,
      value:       authorization.value,
      validAfter:  authorization.validAfter,
      validBefore: authorization.validBefore,
    },
  })

  console.log(`[buyer] Signed. Nonce: ${nonce.slice(0, 10)}...`)

  // Step 3: submit proof to seller
  const proof = {
    ...requirement,
    payload: {
      signature,
      authorization: {
        ...authorization,
        value:       authorization.value.toString(),
        validAfter:  Number(authorization.validAfter),
        validBefore: Number(authorization.validBefore),
      },
    },
  }

  const t0 = Date.now()
  const response = await fetch(`${SELLER_URL}/premium/data`, {
    headers: { 'x-payment-proof': JSON.stringify(proof) },
  })

  const latencyMs = Date.now() - t0
  const result    = await response.json() as any

  if (response.status === 200) {
    console.log(`[buyer] ✅ Access granted in ${latencyMs}ms`)
    console.log(`[buyer] ReceiptId: ${result.receiptId}`)
    console.log(`[buyer] Data:`, JSON.stringify(result.data))

    // Step 4: fetch receipt
    const receipt = await fetch(`${SELLER_URL.replace(':3001', ':3000')}/receipts/${result.receiptId}`)
    if (receipt.ok) {
      const r = await receipt.json()
      console.log(`[buyer] Receipt:`, JSON.stringify(r, null, 2))
    }
  } else {
    console.error(`[buyer] ❌ Payment failed (${response.status}):`, JSON.stringify(result))
  }
}

run().catch((err) => {
  console.error('[buyer] Fatal:', err)
  process.exit(1)
})
