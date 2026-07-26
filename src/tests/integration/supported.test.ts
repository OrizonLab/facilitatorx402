import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../http/app.js'
import type { FastifyInstance } from 'fastify'

describe('GET /supported', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('should return 200 with supported configuration', async () => {
    const response = await app.inject({ method: 'GET', url: '/supported' })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body) as Record<string, unknown>
    expect(body).toHaveProperty('protocols')
    expect(body).toHaveProperty('networks')
    expect(body).toHaveProperty('assets')
    expect(body).toHaveProperty('schemes')
    expect(body).toHaveProperty('fees')
  })

  it('should include x402/v1 in protocols', async () => {
    const response = await app.inject({ method: 'GET', url: '/supported' })
    const body = JSON.parse(response.body) as { protocols: string[] }
    expect(body.protocols).toContain('x402/v1')
  })

  it('should include erc20-transfer scheme', async () => {
    const response = await app.inject({ method: 'GET', url: '/supported' })
    const body = JSON.parse(response.body) as { schemes: string[] }
    expect(body.schemes).toContain('erc20-transfer')
  })
})
