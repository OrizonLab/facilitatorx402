/**
 * Unit tests — Anti-replay protection
 * Mocks Redis and PostgreSQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/infrastructure/redis.js', () => ({
  getRedis: vi.fn(),
}))

vi.mock('../../src/infrastructure/db.js', () => ({
  db: {
    paymentVerification: {
      findFirst: vi.fn(),
    },
  },
}))

import { getRedis } from '../../src/infrastructure/redis.js'
import { db } from '../../src/infrastructure/db.js'
import { checkReplayRedis, checkReplayPostgres, hashSignature } from '../../src/protocol/anti-replay.js'

describe('hashSignature', () => {
  it('returns a 64-char hex string', () => {
    const hash = hashSignature('0x' + 'ab'.repeat(65))
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('is deterministic', () => {
    const sig = '0x' + 'ff'.repeat(65)
    expect(hashSignature(sig)).toBe(hashSignature(sig))
  })
})

describe('checkReplayRedis', () => {
  const mockRedis = { exists: vi.fn() }

  beforeEach(() => {
    vi.mocked(getRedis).mockReturnValue(mockRedis as any)
    mockRedis.exists.mockReset()
  })

  it('returns not duplicate when both keys are absent', async () => {
    mockRedis.exists.mockResolvedValue(0)
    const result = await checkReplayRedis('nonce1', 'sighash1')
    expect(result.isDuplicate).toBe(false)
  })

  it('detects duplicate nonce', async () => {
    mockRedis.exists
      .mockResolvedValueOnce(1) // nonce exists
      .mockResolvedValueOnce(0)
    const result = await checkReplayRedis('nonce1', 'sighash1')
    expect(result.isDuplicate).toBe(true)
    expect(result.reason).toBe('nonce_used')
  })

  it('detects duplicate signature', async () => {
    mockRedis.exists
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1) // sig exists
    const result = await checkReplayRedis('nonce2', 'sighash2')
    expect(result.isDuplicate).toBe(true)
    expect(result.reason).toBe('signature_used')
  })
})

describe('checkReplayPostgres', () => {
  beforeEach(() => {
    vi.mocked(db.paymentVerification.findFirst).mockReset()
  })

  it('returns not duplicate when no record found', async () => {
    vi.mocked(db.paymentVerification.findFirst).mockResolvedValue(null)
    const result = await checkReplayPostgres('nonce3', 'sighash3')
    expect(result.isDuplicate).toBe(false)
  })

  it('detects duplicate nonce from PostgreSQL', async () => {
    vi.mocked(db.paymentVerification.findFirst).mockResolvedValue({
      id: 'v1',
      nonce: 'nonce3',
      signatureHash: 'other',
    } as any)
    const result = await checkReplayPostgres('nonce3', 'sighash3')
    expect(result.isDuplicate).toBe(true)
    expect(result.reason).toBe('nonce_used')
  })

  it('detects duplicate signature from PostgreSQL', async () => {
    vi.mocked(db.paymentVerification.findFirst).mockResolvedValue({
      id: 'v1',
      nonce: 'other',
      signatureHash: 'sighash3',
    } as any)
    const result = await checkReplayPostgres('nonce4', 'sighash3')
    expect(result.isDuplicate).toBe(true)
    expect(result.reason).toBe('signature_used')
  })
})
