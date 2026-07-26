import { describe, it, expect, vi } from 'vitest'
import pino from 'pino'
import { RpcCircuitBreaker } from '../../src/infrastructure/rpc-circuit-breaker.js'

const log = pino({ level: 'silent' })

describe('RpcCircuitBreaker', () => {
  it('starts CLOSED', () => {
    const cb = new RpcCircuitBreaker(log)
    expect(cb.getState()).toBe('CLOSED')
  })

  it('passes through successful calls', async () => {
    const cb = new RpcCircuitBreaker(log)
    const fn = vi.fn(async () => 'ok')
    const result = await cb.call(fn)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('retries on retryable error then succeeds', async () => {
    const cb = new RpcCircuitBreaker(log, { baseDelayMs: 1 })
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls < 3) throw new Error('network timeout')
      return 'recovered'
    })
    const result = await cb.call(fn)
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(cb.getState()).toBe('CLOSED')
  })

  it('does NOT retry on non-retryable error (contract revert)', async () => {
    const cb = new RpcCircuitBreaker(log, { baseDelayMs: 1 })
    const fn = vi.fn(async () => { throw new Error('execution reverted: transfer failed') })
    await expect(cb.call(fn)).rejects.toThrow('execution reverted')
    expect(fn).toHaveBeenCalledOnce()  // no retry
    expect(cb.getState()).toBe('CLOSED')  // circuit not tripped
  })

  it('trips to OPEN after failureThreshold failures', async () => {
    const cb = new RpcCircuitBreaker(log, { failureThreshold: 3, maxRetries: 1, baseDelayMs: 1 })
    const fn = vi.fn(async () => { throw new Error('503 service unavailable') })

    for (let i = 0; i < 3; i++) {
      await cb.call(fn).catch(() => {})
    }

    expect(cb.getState()).toBe('OPEN')
  })

  it('fast-fails when OPEN (code: circuit_open)', async () => {
    const cb = new RpcCircuitBreaker(log, { failureThreshold: 1, maxRetries: 1, baseDelayMs: 1 })
    const fn = vi.fn(async () => { throw new Error('network error') })

    await cb.call(fn).catch(() => {})
    expect(cb.getState()).toBe('OPEN')

    await expect(cb.call(vi.fn())).rejects.toMatchObject({ code: 'circuit_open' })
  })

  it('transitions OPEN → HALF-OPEN after openDurationMs', async () => {
    const cb = new RpcCircuitBreaker(log, {
      failureThreshold: 1,
      maxRetries: 1,
      baseDelayMs: 1,
      openDurationMs: 10,
    })
    const fail = vi.fn(async () => { throw new Error('network error') })
    await cb.call(fail).catch(() => {})
    expect(cb.getState()).toBe('OPEN')

    await new Promise((r) => setTimeout(r, 15))
    // Trigger state check without calling
    ;(cb as any).maybeTransitionFromOpen()
    expect(cb.getState()).toBe('HALF-OPEN')
  })

  it('returns to CLOSED from HALF-OPEN after successThreshold successes', async () => {
    const cb = new RpcCircuitBreaker(log, {
      failureThreshold: 1,
      successThreshold: 2,
      maxRetries: 1,
      baseDelayMs: 1,
      openDurationMs: 10,
    })
    const fail = vi.fn(async () => { throw new Error('network error') })
    await cb.call(fail).catch(() => {})
    await new Promise((r) => setTimeout(r, 15))
    ;(cb as any).maybeTransitionFromOpen()
    ;(cb as any).state = 'HALF-OPEN'

    const ok = vi.fn(async () => 'ok')
    await cb.call(ok)
    await cb.call(ok)
    expect(cb.getState()).toBe('CLOSED')
  })
})
