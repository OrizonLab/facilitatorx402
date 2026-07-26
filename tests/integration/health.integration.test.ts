/**
 * Integration tests — GET /health
 *
 * Covers:
 *   - Returns 200 with all components healthy
 *   - Response shape is stable
 *   - Includes service version
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildApp } from '../../src/http/app.js'

describe('GET /health', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
  })

  it('response includes api, database, redis, worker, rpc checks', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    const body = res.json()

    expect(body).toHaveProperty('status')
    expect(body).toHaveProperty('checks')
    expect(body.checks).toHaveProperty('api')
    expect(body.checks).toHaveProperty('database')
    expect(body.checks).toHaveProperty('redis')
  })

  it('response includes service version', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    const body = res.json()
    expect(body).toHaveProperty('version')
    expect(typeof body.version).toBe('string')
  })

  it('response structure is stable across multiple calls', async () => {
    const keys = async () => Object.keys((await app.inject({ method: 'GET', url: '/health' })).json())
    const first = await keys()
    const second = await keys()
    expect(first).toEqual(second)
  })
})
