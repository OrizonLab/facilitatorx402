/**
 * Fastify application factory.
 *
 * Registers all plugins and routes in dependency order:
 *   1. Rate limiting (Redis-backed)
 *   2. Static file serving (dashboard UI)
 *   3. OpenAPI / Swagger (dev only)
 *   4. Operator routes  : /health, /supported, /metrics
 *   5. Core x402 routes : /verify, /settle, /receipts/:id
 *   6. Seller routes    : /sellers, /sellers/:id/webhooks
 *   7. Dashboard API    : /dashboard/api/*
 *   8. SSE stream       : /dashboard/events
 */
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../infrastructure/config.js'
import { redis } from '../infrastructure/redis.js'
import { logger } from '../infrastructure/logger.js'
import { errorHandler } from './error-handler.js'

// Operator routes
import { healthRoute } from './routes/health.js'
import { supportedRoute } from './routes/supported.js'
import { metricsRoute } from './routes/metrics.js'

// Core x402 routes
import { verifyRoute } from './routes/verify.js'
import { settleRoute } from './routes/settle.js'
import { receiptsRoute } from './routes/receipts.js'

// Seller management routes
import { registerSellerRoutes } from './routes/sellers.route.js'

// Dashboard API + SSE
import { registerDashboardRoutes } from './routes/dashboard.js'
import { registerSseRoute } from './routes/sse.route.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function buildApp() {
  const app = Fastify({
    logger: logger as Parameters<typeof Fastify>[0]['logger'],
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    disableRequestLogging: false,
    bodyLimit: 65536, // 64KB max body
  })

  // ── Rate limiting (Redis-backed, global) ───────────────────────────────────
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_GLOBAL,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: () => ({
      error: {
        code: 'rate_limited',
        reason: 'Too many requests',
        message: 'Rate limit exceeded. Please retry later.',
      },
    }),
  })

  // ── Static dashboard UI ────────────────────────────────────────────────────
  // Serves dashboard-ui.html at GET /dashboard
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '.'),
    prefix: '/dashboard',
    decorateReply: false,
  })

  app.get('/dashboard', async (_req, reply) => {
    return reply.sendFile('dashboard-ui.html')
  })

  // ── Error handler ──────────────────────────────────────────────────────────
  app.setErrorHandler(errorHandler)

  // ── Operator endpoints ─────────────────────────────────────────────────────
  await app.register(healthRoute)
  await app.register(supportedRoute)
  await app.register(metricsRoute)

  // ── Core x402 endpoints ────────────────────────────────────────────────────
  await app.register(verifyRoute)
  await app.register(settleRoute)
  await app.register(receiptsRoute)

  // ── Seller management ──────────────────────────────────────────────────────
  await app.register(registerSellerRoutes)

  // ── Dashboard API + SSE ────────────────────────────────────────────────────
  await app.register(registerDashboardRoutes)
  await app.register(registerSseRoute)

  return app
}
