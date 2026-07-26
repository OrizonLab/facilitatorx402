import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadSecrets, _resetSecrets } from '../../src/infrastructure/secrets.js'

const BASE_ENV = {
  NODE_ENV:              'test',
  DATABASE_URL:          'postgresql://user:pass@localhost:5432/facilitator',
  REDIS_URL:             'redis://localhost:6379',
  RELAYER_PRIVATE_KEY:   '0x' + 'a'.repeat(64),
  RPC_URL:               'https://mainnet.base.org',
  SUPPORTED_NETWORK:     'base-mainnet',
  SUPPORTED_ASSET:       'USDC',
}

beforeEach(() => {
  _resetSecrets()
  // Clear relevant env vars
  Object.keys(BASE_ENV).forEach((k) => delete process.env[k])
})

afterEach(() => {
  _resetSecrets()
  Object.keys(BASE_ENV).forEach((k) => delete process.env[k])
})

describe('loadSecrets', () => {
  it('loads valid env without throwing', () => {
    Object.assign(process.env, BASE_ENV)
    const s = loadSecrets()
    expect(s.SUPPORTED_NETWORK).toBe('base-mainnet')
    expect(s.FEE_BASIS_POINTS).toBe(50)  // default
  })

  it('throws on missing DATABASE_URL', () => {
    Object.assign(process.env, { ...BASE_ENV, DATABASE_URL: undefined })
    expect(() => loadSecrets()).toThrow('DATABASE_URL')
  })

  it('throws on malformed RELAYER_PRIVATE_KEY', () => {
    Object.assign(process.env, { ...BASE_ENV, RELAYER_PRIVATE_KEY: 'not-a-key' })
    expect(() => loadSecrets()).toThrow('RELAYER_PRIVATE_KEY')
  })

  it('throws on invalid RPC_URL', () => {
    Object.assign(process.env, { ...BASE_ENV, RPC_URL: 'not-a-url' })
    expect(() => loadSecrets()).toThrow('RPC_URL')
  })

  it('memoizes after first call', () => {
    Object.assign(process.env, BASE_ENV)
    const s1 = loadSecrets()
    const s2 = loadSecrets()
    expect(s1).toBe(s2)  // same reference
  })

  it('accepts optional RPC_URL_FALLBACK', () => {
    Object.assign(process.env, { ...BASE_ENV, RPC_URL_FALLBACK: 'https://fallback.base.org' })
    const s = loadSecrets()
    expect(s.RPC_URL_FALLBACK).toBe('https://fallback.base.org')
  })
})
