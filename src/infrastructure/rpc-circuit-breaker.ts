/**
 * Circuit breaker + retry wrapper for RPC calls (viem).
 *
 * States:
 *   CLOSED  — normal operation, calls pass through
 *   OPEN    — fast-fail, no calls to RPC
 *   HALF-OPEN — one probe call allowed; if success → CLOSED, if fail → OPEN
 *
 * Retry strategy (CLOSED state only):
 *   - 3 attempts
 *   - Exponential backoff: 200ms, 400ms, 800ms
 *   - Jitter: ± 50ms
 *   - Retryable: network errors, 429, 503, 504
 *   - Non-retryable: invalid nonce, insufficient funds, revert
 */
import pino from 'pino'

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF-OPEN'

export interface CircuitBreakerConfig {
  failureThreshold?: number  // failures before OPEN (default: 5)
  successThreshold?: number  // successes in HALF-OPEN before CLOSED (default: 2)
  openDurationMs?:   number  // ms in OPEN before HALF-OPEN (default: 30_000)
  maxRetries?:       number  // retry attempts in CLOSED (default: 3)
  baseDelayMs?:      number  // base exponential delay (default: 200)
}

const NON_RETRYABLE_PATTERNS = [
  'insufficient funds',
  'nonce too low',
  'execution reverted',
  'gas required exceeds',
  'already known',
]

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : ''
  return !NON_RETRYABLE_PATTERNS.some((p) => msg.includes(p))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class RpcCircuitBreaker {
  private state:           CircuitState = 'CLOSED'
  private failureCount:    number = 0
  private successCount:    number = 0
  private lastOpenedAt:    number = 0

  private readonly failureThreshold: number
  private readonly successThreshold: number
  private readonly openDurationMs:   number
  private readonly maxRetries:       number
  private readonly baseDelayMs:      number
  private readonly log:              pino.Logger

  constructor(log: pino.Logger, cfg: CircuitBreakerConfig = {}) {
    this.failureThreshold = cfg.failureThreshold ?? 5
    this.successThreshold = cfg.successThreshold ?? 2
    this.openDurationMs   = cfg.openDurationMs   ?? 30_000
    this.maxRetries       = cfg.maxRetries       ?? 3
    this.baseDelayMs      = cfg.baseDelayMs      ?? 200
    this.log              = log.child({ module: 'circuit-breaker' })
  }

  getState(): CircuitState { return this.state }

  private trip(): void {
    this.state        = 'OPEN'
    this.lastOpenedAt = Date.now()
    this.failureCount = 0
    this.log.error({ state: this.state }, 'rpc.circuit.opened')
  }

  private reset(): void {
    this.state        = 'CLOSED'
    this.failureCount = 0
    this.successCount = 0
    this.log.info({ state: this.state }, 'rpc.circuit.closed')
  }

  private maybeTransitionFromOpen(): void {
    if (this.state !== 'OPEN') return
    if (Date.now() - this.lastOpenedAt >= this.openDurationMs) {
      this.state        = 'HALF-OPEN'
      this.successCount = 0
      this.log.info({ state: this.state }, 'rpc.circuit.half-open')
    }
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionFromOpen()

    if (this.state === 'OPEN') {
      throw Object.assign(new Error('RPC circuit breaker is OPEN — fast-fail'), {
        code: 'circuit_open',
      })
    }

    let lastErr: unknown
    const attempts = this.state === 'HALF-OPEN' ? 1 : this.maxRetries

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const result = await fn()
        this.onSuccess()
        return result
      } catch (err) {
        lastErr = err
        this.log.warn({ err, attempt }, 'rpc.call.failed')

        if (!isRetryable(err)) {
          // Non-retryable errors (contract revert, etc.) — do not count as circuit failure
          throw err
        }

        this.onFailure()

        if (attempt < attempts - 1) {
          const backoff = this.baseDelayMs * 2 ** attempt + Math.random() * 50
          await delay(backoff)
        }
      }
    }

    throw lastErr
  }

  private onSuccess(): void {
    if (this.state === 'HALF-OPEN') {
      this.successCount++
      if (this.successCount >= this.successThreshold) this.reset()
    } else {
      this.failureCount = Math.max(0, this.failureCount - 1)
    }
  }

  private onFailure(): void {
    if (this.state === 'HALF-OPEN') {
      this.trip()
      return
    }
    this.failureCount++
    if (this.failureCount >= this.failureThreshold) this.trip()
  }
}
