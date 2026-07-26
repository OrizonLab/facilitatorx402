/**
 * Tests unitaires — CircuitBreaker
 *
 * Tests :
 *   1. CLOSED → exécute normalement
 *   2. CLOSED → passe OPEN après failureThreshold échecs consécutifs
 *   3. OPEN → bloque tous les appels immédiatement
 *   4. OPEN → passe HALF_OPEN après resetTimeout
 *   5. HALF_OPEN → passe CLOSED après successThreshold succès
 *   6. HALF_OPEN → retourne OPEN si l'appel test échoue
 *   7. reset() → remet à CLOSED quel que soit l'état
 *   8. Timeout par appel → compte comme un échec
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CircuitBreaker, CircuitOpenError } from '../infrastructure/circuit-breaker.js'

// Mock prom-client pour les tests unitaires
vi.mock('prom-client', () => ({
  Gauge: vi.fn().mockImplementation(() => ({ set: vi.fn() })),
  Counter: vi.fn().mockImplementation(() => ({ inc: vi.fn() })),
  register: { registerMetric: vi.fn() },
}))

const makeOpts = (overrides = {}) => ({
  name: 'test-cb',
  failureThreshold: 3,
  successThreshold: 2,
  resetTimeoutMs: 100, // court pour les tests
  callTimeoutMs: 50,
  ...overrides,
})

describe('CircuitBreaker — état CLOSED', () => {
  it('exécute la fonction normalement', async () => {
    const cb = new CircuitBreaker(makeOpts())
    const result = await cb.execute(() => Promise.resolve('ok'))
    expect(result).toBe('ok')
    expect(cb.getState()).toBe('CLOSED')
  })

  it('propage les erreurs sans ouvrir si sous le seuil', async () => {
    const cb = new CircuitBreaker(makeOpts({ failureThreshold: 3 }))
    await expect(cb.execute(() => Promise.reject(new Error('fail 1')))).rejects.toThrow('fail 1')
    await expect(cb.execute(() => Promise.reject(new Error('fail 2')))).rejects.toThrow('fail 2')
    expect(cb.getState()).toBe('CLOSED') // seuil = 3, seulement 2 échecs
  })

  it('passe OPEN après failureThreshold échecs consécutifs', async () => {
    const cb = new CircuitBreaker(makeOpts({ failureThreshold: 3 }))
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(() => Promise.reject(new Error('err')))).rejects.toThrow()
    }
    expect(cb.getState()).toBe('OPEN')
  })

  it('réinitialise le compteur d\'échecs après un succès', async () => {
    const cb = new CircuitBreaker(makeOpts({ failureThreshold: 3 }))
    await expect(cb.execute(() => Promise.reject(new Error()))).rejects.toThrow()
    await expect(cb.execute(() => Promise.reject(new Error()))).rejects.toThrow()
    await cb.execute(() => Promise.resolve('success')) // remet le compteur à 0
    await expect(cb.execute(() => Promise.reject(new Error()))).rejects.toThrow()
    expect(cb.getState()).toBe('CLOSED') // seulement 1 échec depuis le dernier succès
  })
})

describe('CircuitBreaker — état OPEN', () => {
  it('bloque les appels immédiatement avec CircuitOpenError', async () => {
    const cb = new CircuitBreaker(makeOpts({ failureThreshold: 1 }))
    await expect(cb.execute(() => Promise.reject(new Error()))).rejects.toThrow()
    expect(cb.getState()).toBe('OPEN')

    await expect(cb.execute(() => Promise.resolve('blocked'))).rejects.toThrow(CircuitOpenError)
  })

  it('passe HALF_OPEN après resetTimeoutMs', async () => {
    const cb = new CircuitBreaker(makeOpts({ failureThreshold: 1, resetTimeoutMs: 50 }))
    await expect(cb.execute(() => Promise.reject(new Error()))).rejects.toThrow()
    expect(cb.getState()).toBe('OPEN')

    await new Promise((r) => setTimeout(r, 60)) // attendre le reset
    expect(cb.isOpen()).toBe(false) // déclenche la transition HALF_OPEN
    expect(cb.getState()).toBe('HALF_OPEN')
  })
})

describe('CircuitBreaker — état HALF_OPEN', () => {
  async function getHalfOpenCb() {
    const cb = new CircuitBreaker(makeOpts({ failureThreshold: 1, resetTimeoutMs: 50, successThreshold: 2 }))
    await expect(cb.execute(() => Promise.reject(new Error()))).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 60))
    cb.isOpen() // trigger transition
    expect(cb.getState()).toBe('HALF_OPEN')
    return cb
  }

  it('passe CLOSED après successThreshold succès consécutifs', async () => {
    const cb = await getHalfOpenCb()
    await cb.execute(() => Promise.resolve('ok1'))
    await cb.execute(() => Promise.resolve('ok2'))
    expect(cb.getState()).toBe('CLOSED')
  })

  it('retourne OPEN si l\'appel test échoue', async () => {
    const cb = await getHalfOpenCb()
    await expect(cb.execute(() => Promise.reject(new Error('test failed')))).rejects.toThrow()
    expect(cb.getState()).toBe('OPEN')
  })
})

describe('CircuitBreaker — reset et timeout', () => {
  it('reset() remet à CLOSED quelle que soit l\'état', async () => {
    const cb = new CircuitBreaker(makeOpts({ failureThreshold: 1 }))
    await expect(cb.execute(() => Promise.reject(new Error()))).rejects.toThrow()
    expect(cb.getState()).toBe('OPEN')
    cb.reset()
    expect(cb.getState()).toBe('CLOSED')
  })

  it('callTimeout compte comme un échec', async () => {
    const cb = new CircuitBreaker(makeOpts({ failureThreshold: 1, callTimeoutMs: 10 }))
    await expect(
      cb.execute(() => new Promise((r) => setTimeout(r, 50))) // plus long que le timeout
    ).rejects.toThrow()
    expect(cb.getState()).toBe('OPEN')
  })
})
