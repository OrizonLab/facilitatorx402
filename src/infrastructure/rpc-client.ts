/**
 * RPC Client — viem resilient avec circuit breaker + failover.
 *
 * Architecture :
 *   1. Tente le RPC primaire via CircuitBreaker
 *   2. Si OPEN ou erreur → bascule sur le RPC fallback
 *   3. Si fallback aussi en échec → lève une RpcUnavailableError
 *
 * Usage :
 *   import { rpcClient } from '../infrastructure/rpc-client.js'
 *   const block = await rpcClient.getBlockNumber()
 *   const receipt = await rpcClient.waitForTransactionReceipt({ hash: '0x...' })
 *
 * Métriques :
 *   rpc_calls_total{rpc,status}         — appels par RPC endpoint
 *   rpc_failover_total                  — nombre de basculements fallback
 *   circuit_breaker_state{name}         — état du circuit breaker
 */
import { createPublicClient, createWalletClient, http, type Hash, type TransactionReceipt } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import { Counter, register } from 'prom-client'
import { getConfig } from './config.js'
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js'
import { logger } from './logger.js'

const rpcCallsCounter = new Counter({
  name: 'rpc_calls_total',
  help: 'Total RPC calls by endpoint and status',
  labelNames: ['rpc', 'status'], // status: success | error | circuit_open
  registers: [register],
})

const rpcFailoverCounter = new Counter({
  name: 'rpc_failover_total',
  help: 'Total RPC failovers to secondary endpoint',
  registers: [register],
})

export class RpcUnavailableError extends Error {
  constructor(message = 'All RPC endpoints are unavailable') {
    super(message)
    this.name = 'RpcUnavailableError'
  }
}

class ResilientRpcClient {
  private primaryCb: CircuitBreaker
  private fallbackCb: CircuitBreaker
  private config = getConfig()

  constructor() {
    this.primaryCb = new CircuitBreaker({
      name: 'rpc-primary',
      failureThreshold: this.config.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      resetTimeoutMs: this.config.CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
      callTimeoutMs: this.config.RPC_CALL_TIMEOUT_MS,
    })
    this.fallbackCb = new CircuitBreaker({
      name: 'rpc-fallback',
      failureThreshold: this.config.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      resetTimeoutMs: this.config.CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
      callTimeoutMs: this.config.RPC_CALL_TIMEOUT_MS,
    })
  }

  private makePublicClient(rpcUrl: string) {
    return createPublicClient({ chain: base, transport: http(rpcUrl) })
  }

  private makeWalletClient(rpcUrl: string) {
    const account = privateKeyToAccount(this.config.FACILITATOR_PRIVATE_KEY as `0x${string}`)
    return createWalletClient({ account, chain: base, transport: http(rpcUrl) })
  }

  async withPrimary<T>(fn: (rpcUrl: string) => Promise<T>): Promise<T> {
    const primaryUrl = this.config.RPC_URL
    try {
      const result = await this.primaryCb.execute(() => fn(primaryUrl))
      rpcCallsCounter.inc({ rpc: 'primary', status: 'success' })
      return result
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        rpcCallsCounter.inc({ rpc: 'primary', status: 'circuit_open' })
      } else {
        rpcCallsCounter.inc({ rpc: 'primary', status: 'error' })
        logger.warn({ err, rpc: primaryUrl }, 'RPC primary failed, trying fallback')
      }
      return this.withFallback(fn)
    }
  }

  async withFallback<T>(fn: (rpcUrl: string) => Promise<T>): Promise<T> {
    const fallbackUrl = this.config.RPC_URL_FALLBACK
    if (!fallbackUrl) {
      throw new RpcUnavailableError('No fallback RPC configured and primary is unavailable')
    }
    try {
      rpcFailoverCounter.inc()
      const result = await this.fallbackCb.execute(() => fn(fallbackUrl))
      rpcCallsCounter.inc({ rpc: 'fallback', status: 'success' })
      return result
    } catch (err) {
      rpcCallsCounter.inc({ rpc: 'fallback', status: 'error' })
      logger.error({ err, rpc: fallbackUrl }, 'RPC fallback also failed')
      throw new RpcUnavailableError('Both primary and fallback RPC are unavailable')
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async getBlockNumber(): Promise<bigint> {
    return this.withPrimary((url) => this.makePublicClient(url).getBlockNumber())
  }

  async waitForTransactionReceipt(hash: Hash, confirmations = 1): Promise<TransactionReceipt> {
    return this.withPrimary((url) =>
      this.makePublicClient(url).waitForTransactionReceipt({ hash, confirmations })
    )
  }

  async sendTransaction(txRequest: Parameters<ReturnType<typeof createWalletClient>['sendTransaction']>[0]): Promise<Hash> {
    return this.withPrimary((url) => this.makeWalletClient(url).sendTransaction(txRequest))
  }

  getCircuitStates() {
    return {
      primary: this.primaryCb.getState(),
      fallback: this.fallbackCb.getState(),
    }
  }

  resetCircuits() {
    this.primaryCb.reset()
    this.fallbackCb.reset()
  }
}

export const rpcClient = new ResilientRpcClient()
