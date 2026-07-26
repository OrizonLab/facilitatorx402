import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../http/app.js'
import type { FastifyInstance } from 'fastify'

describe('GET /health', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('should respond with a health object', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    const body = JSON.parse(response.body) as Record<string, unknown>
    expect(response.statusCode).toBeOneOf([200, 503])
    expect(body).toHaveProperty('status')
    expect(body).toHaveProperty('version')
    expect(body).toHaveProperty('checks')
    expect(body).toHaveProperty('timestamp')
  })

  it('checks object should have all required keys', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    const body = JSON.parse(response.body) as { checks: Record<string, string> }
    expect(body.checks).toHaveProperty('database')
    expect(body.checks).toHaveProperty('redis')
    expect(body.checks).toHaveProperty('worker')
    expect(body.checks).toHaveProperty('rpc')
  })
})
