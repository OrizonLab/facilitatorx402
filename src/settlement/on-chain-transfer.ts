import { createWalletClient, createPublicClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import type { Hash } from 'viem'
import { config } from '../infrastructure/config.js'
import { logger } from '../infrastructure/logger.js'

const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
])

let _rpcFailing = 0
let _circuitOpen = false
let _circuitOpenAt: number | null = null

function isCircuitOpen(): boolean {
  if (!_circuitOpen) return false
  const cooldown = config.RPC_CIRCUIT_BREAKER_COOLDOWN_SECONDS * 1000
  if (_circuitOpenAt && Date.now() - _circuitOpenAt > cooldown) {
    _circuitOpen = false
    _rpcFailing = 0
    logger.info('RPC circuit breaker: HALF-OPEN (cooldown elapsed)')
  }
  return _circuitOpen
}

function getRpcUrl(): string {
  if (isCircuitOpen() && config.RPC_URL_FALLBACK) {
    logger.warn('RPC circuit breaker OPEN — using fallback RPC')
    return config.RPC_URL_FALLBACK
  }
  return config.RPC_URL
}

function recordRpcSuccess(): void {
  _rpcFailing = 0
  _circuitOpen = false
}

function recordRpcFailure(): void {
  _rpcFailing++
  if (_rpcFailing >= config.RPC_CIRCUIT_BREAKER_THRESHOLD) {
    _circuitOpen = true
    _circuitOpenAt = Date.now()
    logger.error({ failures: _rpcFailing }, 'RPC circuit breaker: OPEN')
  }
}

export async function submitTransfer(params: {
  to: string
  amount: bigint
  requestId: string
}): Promise<Hash> {
  const account = privateKeyToAccount(config.FACILITATOR_PRIVATE_KEY as `0x${string}`)
  const rpcUrl = getRpcUrl()

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl, { timeout: 30000 }),
  })

  const log = logger.child({ requestId: params.requestId })
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= config.RPC_MAX_RETRIES; attempt++) {
    try {
      log.info({ attempt, to: params.to, amount: params.amount.toString() }, 'Submitting on-chain transfer')

      const txHash = await walletClient.writeContract({
        address: config.SUPPORTED_ASSET_ADDRESS as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [params.to as `0x${string}`, params.amount],
      })

      recordRpcSuccess()
      log.info({ txHash }, 'Transfer submitted')
      return txHash
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      // Don't retry deterministic failures
      if (lastError.message.includes('revert') || lastError.message.includes('insufficient')) {
        recordRpcFailure()
        throw lastError
      }
      recordRpcFailure()
      log.warn({ attempt, err: lastError.message }, 'RPC call failed, retrying...')
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1))) // Exponential backoff
    }
  }

  throw lastError ?? new Error('Transfer failed after max retries')
}

export async function waitForConfirmation(txHash: Hash, requestId: string): Promise<bigint> {
  const client = createPublicClient({
    chain: base,
    transport: http(getRpcUrl(), { timeout: config.SETTLEMENT_TIMEOUT_SECONDS * 1000 }),
  })

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    confirmations: config.CONFIRMATIONS_REQUIRED,
    timeout: config.SETTLEMENT_TIMEOUT_SECONDS * 1000,
  })

  if (receipt.status === 'reverted') {
    throw new Error('Transaction was reverted on-chain')
  }

  logger.info({ requestId, txHash, blockNumber: receipt.blockNumber.toString() }, 'Transaction confirmed')
  return receipt.gasUsed
}
