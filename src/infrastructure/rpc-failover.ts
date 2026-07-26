/**
 * RPC failover: wraps two RpcCircuitBreaker instances (primary + fallback).
 *
 * Strategy:
 *   1. Try primary RPC via circuit breaker.
 *   2. If primary circuit is OPEN or call fails after retries → try fallback RPC.
 *   3. If no fallback configured → propagate original error.
 *
 * Each RPC gets its own independent circuit breaker state.
 */
import { RpcCircuitBreaker, type CircuitBreakerConfig } from './rpc-circuit-breaker.js'
import type pino from 'pino'

export interface RpcFailoverConfig {
  primaryUrl:   string
  fallbackUrl?: string
  breaker?:     CircuitBreakerConfig
}

export class RpcFailoverClient {
  private readonly primaryBreaker:  RpcCircuitBreaker
  private readonly fallbackBreaker: RpcCircuitBreaker | null
  private readonly log: pino.Logger

  constructor(log: pino.Logger, cfg: RpcFailoverConfig) {
    this.log             = log.child({ module: 'rpc-failover' })
    this.primaryBreaker  = new RpcCircuitBreaker(log, cfg.breaker)
    this.fallbackBreaker = cfg.fallbackUrl
      ? new RpcCircuitBreaker(log, cfg.breaker)
      : null
  }

  /**
   * Execute `fn(rpcUrl)` with failover.
   * `fn` receives the resolved RPC URL to pass to viem's `publicClient`.
   */
  async call<T>(primaryUrl: string, fn: (url: string) => Promise<T>): Promise<T> {
    try {
      return await this.primaryBreaker.call(() => fn(primaryUrl))
    } catch (primaryErr) {
      if (!this.fallbackBreaker) {
        this.log.error({ primaryErr }, 'rpc.failover.no_fallback')
        throw primaryErr
      }

      this.log.warn({ primaryErr }, 'rpc.failover.switching_to_fallback')

      // fallbackUrl is guaranteed to exist when fallbackBreaker is set
      const fallbackUrl = (this as any)._fallbackUrl as string
      return await this.fallbackBreaker.call(() => fn(fallbackUrl))
    }
  }

  getStates() {
    return {
      primary:  this.primaryBreaker.getState(),
      fallback: this.fallbackBreaker?.getState() ?? null,
    }
  }
}
