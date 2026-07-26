/**
 * Circuit Breaker — protection RPC on-chain.
 *
 * États :
 *   CLOSED     → appels normaux. Comptabilise les échecs.
 *   OPEN       → bloque tous les appels pendant RESET_TIMEOUT_MS.
 *   HALF_OPEN  → laisse passer UN appel test. Succès → CLOSED. Échec → OPEN.
 *
 * Usage :
 *   const cb = new CircuitBreaker({ name: 'rpc-primary', failureThreshold: 5 })
 *   const result = await cb.execute(() => viemClient.getBlockNumber())
 *
 * Métriques Prometheus exposées automatiquement :
 *   circuit_breaker_state{name}     0=CLOSED 1=OPEN 2=HALF_OPEN
 *   circuit_breaker_failures_total{name}
 *   circuit_breaker_opens_total{name}
 */
import { Gauge, Counter, register } from 'prom-client'
import { logger } from './logger.js'

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface CircuitBreakerOptions {
  name: string
  failureThreshold?: number   // échecs consécutifs avant OPEN (défaut: 5)
  successThreshold?: number   // succès consécutifs en HALF_OPEN avant CLOSED (défaut: 2)
  resetTimeoutMs?: number     // durée OPEN avant passage en HALF_OPEN (défaut: 30s)
  callTimeoutMs?: number      // timeout par appel (défaut: 10s)
}

const cbStateGauge = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state: 0=CLOSED 1=OPEN 2=HALF_OPEN',
  labelNames: ['name'],
  registers: [register],
})

const cbFailuresCounter = new Counter({
  name: 'circuit_breaker_failures_total',
  help: 'Total failures recorded by circuit breaker',
  labelNames: ['name'],
  registers: [register],
})

const cbOpensCounter = new Counter({
  name: 'circuit_breaker_opens_total',
  help: 'Total times circuit breaker transitioned to OPEN',
  labelNames: ['name'],
  registers: [register],
})

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED'
  private failures = 0
  private successes = 0
  private lastOpenedAt: number | null = null

  private readonly name: string
  private readonly failureThreshold: number
  private readonly successThreshold: number
  private readonly resetTimeoutMs: number
  private readonly callTimeoutMs: number

  constructor(opts: CircuitBreakerOptions) {
    this.name = opts.name
    this.failureThreshold = opts.failureThreshold ?? 5
    this.successThreshold = opts.successThreshold ?? 2
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000
    this.callTimeoutMs = opts.callTimeoutMs ?? 10_000
    cbStateGauge.set({ name: this.name }, 0) // start CLOSED
  }

  getState(): CircuitState {
    return this.state
  }

  isOpen(): boolean {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - (this.lastOpenedAt ?? 0)
      if (elapsed >= this.resetTimeoutMs) {
        this.transitionTo('HALF_OPEN')
        return false
      }
      return true
    }
    return false
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new CircuitOpenError(`Circuit breaker [${this.name}] is OPEN. Calls blocked.`)
    }

    try {
      const result = await this.withTimeout(fn)
      this.onSuccess()
      return result
    } catch (err) {
      if (err instanceof CircuitOpenError) throw err
      this.onFailure(err)
      throw err
    }
  }

  private withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Circuit breaker [${this.name}] call timeout (${this.callTimeoutMs}ms)`)), this.callTimeoutMs)
      fn().then(
        (v) => { clearTimeout(timer); resolve(v) },
        (e) => { clearTimeout(timer); reject(e) },
      )
    })
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successes++
      if (this.successes >= this.successThreshold) {
        this.transitionTo('CLOSED')
      }
    } else {
      this.failures = 0
    }
  }

  private onFailure(err: unknown): void {
    cbFailuresCounter.inc({ name: this.name })
    this.failures++
    this.successes = 0
    logger.warn({ circuitBreaker: this.name, failures: this.failures, state: this.state, err }, 'circuit breaker failure recorded')

    if (this.state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
      this.transitionTo('OPEN')
    }
  }

  private transitionTo(next: CircuitState): void {
    const prev = this.state
    this.state = next

    if (next === 'OPEN') {
      this.lastOpenedAt = Date.now()
      this.failures = 0
      cbOpensCounter.inc({ name: this.name })
      cbStateGauge.set({ name: this.name }, 1)
      logger.error({ circuitBreaker: this.name, prev, next }, 'circuit breaker OPENED')
    } else if (next === 'HALF_OPEN') {
      this.successes = 0
      cbStateGauge.set({ name: this.name }, 2)
      logger.warn({ circuitBreaker: this.name, prev, next }, 'circuit breaker HALF_OPEN — testing')
    } else if (next === 'CLOSED') {
      this.failures = 0
      this.successes = 0
      cbStateGauge.set({ name: this.name }, 0)
      logger.info({ circuitBreaker: this.name, prev, next }, 'circuit breaker CLOSED — recovered')
    }
  }

  // Force reset — for tests and admin ops
  reset(): void {
    this.state = 'CLOSED'
    this.failures = 0
    this.successes = 0
    this.lastOpenedAt = null
    cbStateGauge.set({ name: this.name }, 0)
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CircuitOpenError'
  }
}
