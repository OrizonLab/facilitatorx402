/**
 * Fastify application factory.
 *
 * Registers all plugins and routes in dependency order:
 *   1. Security headers (@fastify/helmet)
 *   2. Rate limiting (Redis-backed)
 *   3. Static file serving (dashboard UI)
 *   4. OpenAPI / Swagger (dev only)
 *   5. Operator routes  : /health, /supported, /metrics
 *   6. Core x402 routes : /verify, /settle, /receipts/:id
 *   7. Seller routes    : /sellers, /sellers/:id/webhooks
 *   8. Dashboard API    : /dashboard/api/*
 *   9. SSE stream       : /dashboard/events
 *
 * Security notes:
 *   - @fastify/helmet sets X-Content-Type-Options, X-Frame-Options,
 *     Strict-Transport-Security, Content-Security-Policy, etc.
 *   - Rate limiting is Redis-backed and keyed by IP (global)
 *   - Per-seller rate limiting is applied inside verify and settle routes
 *   - All token comparisons use timingSafeEqual via safeEqual()
 */
import Fastify from 'fastify'
import helmet from '@fastify/helmet'
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
import { registerSellersRoutes } from './routes/sellers.route.js'

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

  // ── Security headers (must be first) ───────────────────────────────────────
  await app.register(helmet, {
    // Allow SSE from same origin for the dashboard
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],  // dashboard UI inline scripts
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    // HSTS: 1 year, include subdomains
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: true,
    },
    // Disable X-Powered-By (already off in Fastify, belt-and-suspenders)
    hidePoweredBy: true,
    // Prevent MIME sniffing
    noSniff: true,
    // Prevent clickjacking
    frameguard: { action: 'deny' },
    // XSS filter for legacy browsers
    xssFilter: true,
  })

  // ── Rate limiting (Redis-backed, global) ─────────────────────────────────
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

  // ── Static dashboard UI ──────────────────────────────────────────────────
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
  await app.register(registerSellersRoutes)

  // ── Dashboard API + SSE ────────────────────────────────────────────────────
  await app.register(registerDashboardRoutes)
  await app.register(registerSseRoute)

  return app
}
