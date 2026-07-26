import { describe, it, expect, beforeEach, vi } from 'vitest'
import { claimNonce, claimSignatureHash, isNonceSeen, releaseNonce } from '../../src/infrastructure/anti-replay.js'

// Mock Redis client
const mockRedis = {
  store: new Map<string, string>(),
  async set(key: string, value: string, _ex: string, _ttl: number, flag: string) {
    if (flag === 'NX') {
      if (this.store.has(key)) return null
      this.store.set(key, value)
      return 'OK'
    }
    this.store.set(key, value)
    return 'OK'
  },
  async get(key: string) {
    return this.store.get(key) ?? null
  },
  async del(key: string) {
    this.store.delete(key)
    return 1
  },
}

beforeEach(() => {
  mockRedis.store.clear()
})

describe('claimNonce', () => {
  const redis = mockRedis as any

  it('claims a fresh nonce', async () => {
    const result = await claimNonce(redis, '0x' + '1'.repeat(64))
    expect(result).toBe(true)
  })

  it('rejects a duplicate nonce', async () => {
    const nonce = '0x' + '2'.repeat(64)
    await claimNonce(redis, nonce)
    const result = await claimNonce(redis, nonce)
    expect(result).toBe(false)
  })

  it('is case-insensitive', async () => {
    const nonce = '0x' + 'aAbB'.repeat(16)
    await claimNonce(redis, nonce.toUpperCase())
    const result = await claimNonce(redis, nonce.toLowerCase())
    expect(result).toBe(false)
  })
})

describe('claimSignatureHash', () => {
  const redis = mockRedis as any

  it('claims a fresh signature hash', async () => {
    const hash = '0x' + 'a'.repeat(130)
    expect(await claimSignatureHash(redis, hash)).toBe(true)
  })

  it('rejects duplicate', async () => {
    const hash = '0x' + 'b'.repeat(130)
    await claimSignatureHash(redis, hash)
    expect(await claimSignatureHash(redis, hash)).toBe(false)
  })
})

describe('releaseNonce', () => {
  const redis = mockRedis as any

  it('allows re-claim after release', async () => {
    const nonce = '0x' + 'c'.repeat(64)
    await claimNonce(redis, nonce)
    await releaseNonce(redis, nonce)
    const result = await claimNonce(redis, nonce)
    expect(result).toBe(true)
  })
})

describe('isNonceSeen', () => {
  const redis = mockRedis as any

  it('returns false for unknown nonce', async () => {
    const nonce = '0x' + 'd'.repeat(64)
    expect(await isNonceSeen(redis, nonce)).toBe(false)
  })

  it('returns true after claim', async () => {
    const nonce = '0x' + 'e'.repeat(64)
    await claimNonce(redis, nonce)
    expect(await isNonceSeen(redis, nonce)).toBe(true)
  })
})
