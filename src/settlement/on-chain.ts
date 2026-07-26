/**
 * On-chain settlement — submits transferWithAuthorization via viem.
 *
 * Uses ERC-3009 transferWithAuthorization on the USDC contract.
 * The facilitator wallet signs and broadcasts the transaction.
 *
 * Circuit breaker:
 *   - Primary RPC: RPC_URL
 *   - Fallback RPC: RPC_URL_TESTNET (or fallbackRpcUrl from NetworkRegistry)
 *   - Retries: 3 attempts with exponential backoff
 *   - Timeout: 30s per attempt
 *
 * PostgreSQL ONLY — no local state stored outside PG.
 */
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  privateKeyToAccount,
} from 'viem'
import { base } from 'viem/chains'
import { getConfig } from '../infrastructure/config.js'
import { networkRegistry } from '../infrastructure/network-registry.js'
import { logger } from '../infrastructure/logger.js'

const TRANSFER_WITH_AUTHORIZATION_ABI = parseAbi([
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external',
])

export interface OnChainResult {
  txHash: `0x${string}`
  blockNumber?: bigint
  gasUsed?: bigint
}

function splitSignature(sig: `0x${string}`): { v: number; r: `0x${string}`; s: `0x${string}` } {
  const bytes = Buffer.from(sig.slice(2), 'hex')
  const r = ('0x' + bytes.subarray(0, 32).toString('hex')) as `0x${string}`
  const s = ('0x' + bytes.subarray(32, 64).toString('hex')) as `0x${string}`
  const v = bytes[64]!
  return { v, r, s }
}

export async function submitOnChain(opts: {
  from: `0x${string}`
  to: `0x${string}`
  value: bigint
  validAfter: bigint
  validBefore: bigint
  nonce: `0x${string}`
  signature: `0x${string}`
  assetAddress: `0x${string}`
  chainId: number
  rpcUrl: string
  fallbackRpcUrl?: string | null
}): Promise<OnChainResult> {
  const config = getConfig()
  const account = privateKeyToAccount(config.FACILITATOR_PRIVATE_KEY as `0x${string}`)

  const { v, r, s } = splitSignature(opts.signature)

  // Try primary RPC, then fallback
  const rpcUrls = [opts.rpcUrl, opts.fallbackRpcUrl].filter(Boolean) as string[]

  let lastError: unknown
  for (const rpcUrl of rpcUrls) {
    try {
      const walletClient = createWalletClient({
        account,
        transport: http(rpcUrl, { timeout: 30_000, retryCount: 3, retryDelay: 1_000 }),
        chain: base, // V1: Base mainnet
      })

      const publicClient = createPublicClient({
        transport: http(rpcUrl, { timeout: 30_000, retryCount: 3, retryDelay: 1_000 }),
        chain: base,
      })

      logger.info({ rpcUrl, from: opts.from, to: opts.to, value: opts.value.toString() }, 'submitting on-chain')

      const txHash = await walletClient.writeContract({
        address: opts.assetAddress,
        abi: TRANSFER_WITH_AUTHORIZATION_ABI,
        functionName: 'transferWithAuthorization',
        args: [
          opts.from,
          opts.to,
          opts.value,
          opts.validAfter,
          opts.validBefore,
          opts.nonce,
          v,
          r,
          s,
        ],
      })

      logger.info({ txHash }, 'tx submitted, waiting for receipt...')

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: getConfig().MIN_CONFIRMATIONS,
        timeout: 30_000,
      })

      logger.info({ txHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status }, 'tx confirmed')

      if (receipt.status === 'reverted') {
        throw new Error(`Transaction reverted: ${txHash}`)
      }

      return {
        txHash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      }
    } catch (err) {
      lastError = err
      logger.warn({ err, rpcUrl }, 'RPC attempt failed, trying fallback...')
    }
  }

  throw lastError ?? new Error('All RPC endpoints failed')
}
