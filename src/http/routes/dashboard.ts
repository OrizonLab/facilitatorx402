/**
 * Dashboard opérateur — Routes GET
 *
 * Endpoints disponibles :
 *
 *   GET /dashboard/api/stats
 *       Statistiques agrégées JSON (volume, commission, taux d'échec)
 *
 *   GET /dashboard/api/settlements
 *       Table paginée des settlements avec filtres
 *       Query params : network, asset, status, page, limit
 *
 *   GET /dashboard/api/webhooks
 *       Table paginée des livraisons webhook avec statut
 *
 *   GET /dashboard/events
 *       Server-Sent Events (SSE) pour les settlements en temps réel
 *
 * Sécurité :
 *   - DASHBOARD_TOKEN requis (obligatoire via config Zod)
 *   - Comparaison par timingSafeEqual (anti timing attack)
 *   - Query params validés via Zod (anti injection d'enum Prisma)
 *   - SSE : max MAX_SSE_CONNECTIONS connexions simultanées
 *   - Read-only — aucun endpoint de mutation
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../infrastructure/prisma.js'
import { logger } from '../../infrastructure/logger.js'
import { getConfig } from '../../infrastructure/config.js'
import { safeEqual } from '../../infrastructure/safe-compare.js'

// ── SSE connection cap ─────────────────────────────────────────────
// Prevents file descriptor exhaustion from unbounded SSE connections.
const MAX_SSE_CONNECTIONS = 50
let activeSseConnections = 0

// ── Query param schemas ───────────────────────────────────────────
const SettlementQuerySchema = z.object({
  status: z.enum(['pending', 'confirmed', 'failed']).optional(),
  network: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const WebhookQuerySchema = z.object({
  status: z.enum(['pending', 'delivered', 'failed']).optional(),
  event: z.enum(['settlement.confirmed', 'settlement.failed', 'verify.accepted', 'verify.rejected']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// ── Auth middleware ───────────────────────────────────────────────

function assertDashboardAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const config = getConfig()
  const auth = (request.headers['authorization'] ?? '') as string
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''

  if (!safeEqual(token, config.DASHBOARD_TOKEN)) {
    reply
      .status(401)
      .header('WWW-Authenticate', 'Bearer realm="facilitatorx402 dashboard"')
      .send({
        error: {
          code: 'unauthorized',
          reason: 'Missing or invalid dashboard token',
          message: 'Provide Authorization: Bearer <DASHBOARD_TOKEN>',
        },
      })
    return false
  }
  return true
}

// ── Plugin ─────────────────────────────────────────────────────────────
// Exported as `registerDashboardRoutes` to match the import in app.ts
export async function registerDashboardRoutes(app: FastifyInstance) {

  // GET /dashboard/api/stats — Aggregated stats
  app.get('/dashboard/api/stats', async (request, reply) => {
    if (!assertDashboardAuth(request, reply)) return

    const [totalSettlements, confirmedSettlements, failedSettlements, pendingSettlements] = await Promise.all([
      prisma.paymentSettlement.count(),
      prisma.paymentSettlement.count({ where: { settlementStatus: 'confirmed' } }),
      prisma.paymentSettlement.count({ where: { settlementStatus: 'failed' } }),
      prisma.paymentSettlement.count({ where: { settlementStatus: 'pending' } }),
    ])

    const recentSettlements = await prisma.paymentSettlement.findMany({
      where: { settlementStatus: 'confirmed' },
      select: { feeAmount: true, developerShare: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    })

    const totalFees = recentSettlements.reduce((sum, s) => {
      return sum + BigInt(s.feeAmount ?? '0')
    }, BigInt(0))

    return reply.send({
      settlements: {
        total: totalSettlements,
        confirmed: confirmedSettlements,
        failed: failedSettlements,
        pending: pendingSettlements,
        successRate: totalSettlements > 0
          ? ((confirmedSettlements / totalSettlements) * 100).toFixed(2) + '%'
          : 'N/A',
      },
      fees: {
        totalGenerated: totalFees.toString(),
        currency: 'USDC (base units)',
      },
      generatedAt: new Date().toISOString(),
    })
  })

  // GET /dashboard/api/settlements — Paginated settlement table
  app.get('/dashboard/api/settlements', async (request, reply) => {
    if (!assertDashboardAuth(request, reply)) return

    const parsed = SettlementQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'invalid_query', reason: 'Invalid query parameters', message: parsed.error.errors[0]?.message },
      })
    }
    const { status, network, page, limit } = parsed.data
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = {}
    if (status) where.settlementStatus = status
    if (network) where.request = { network: { name: network } }

    const [data, total] = await Promise.all([
      prisma.paymentSettlement.findMany({
        where,
        include: {
          request: {
            select: {
              asset: true,
              amount: true,
              buyerAddress: true,
              invoiceId: true,
              network: { select: { name: true, chainId: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.paymentSettlement.count({ where }),
    ])

    return reply.send({
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  })

  // GET /dashboard/api/webhooks — Paginated webhook delivery table
  app.get('/dashboard/api/webhooks', async (request, reply) => {
    if (!assertDashboardAuth(request, reply)) return

    const parsed = WebhookQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'invalid_query', reason: 'Invalid query parameters', message: parsed.error.errors[0]?.message },
      })
    }
    const { status, event, page, limit } = parsed.data
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (event) where.event = event

    const [data, total] = await Promise.all([
      prisma.webhookDelivery.findMany({
        where,
        include: {
          subscription: { select: { sellerId: true, url: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.webhookDelivery.count({ where }),
    ])

    return reply.send({
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  })

  // GET /dashboard/events — SSE stream for real-time settlements
  app.get('/dashboard/events', async (request, reply) => {
    if (!assertDashboardAuth(request, reply)) return

    // Cap concurrent SSE connections to prevent FD exhaustion
    if (activeSseConnections >= MAX_SSE_CONNECTIONS) {
      return reply.status(503).send({
        error: {
          code: 'sse_capacity_exceeded',
          reason: 'Too many active SSE connections',
          message: `Maximum of ${MAX_SSE_CONNECTIONS} concurrent SSE connections allowed. Retry later.`,
        },
      })
    }

    activeSseConnections++
    logger.debug({ activeSseConnections }, 'SSE client connected')

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    reply.raw.write('event: connected\ndata: {"status":"connected"}\n\n')

    let lastId: string | null = null
    const interval = setInterval(async () => {
      try {
        const settlements = await prisma.paymentSettlement.findMany({
          where: lastId ? { id: { gt: lastId } } : {},
          orderBy: { createdAt: 'asc' },
          take: 10,
          include: {
            request: {
              select: { asset: true, amount: true, network: { select: { name: true } } },
            },
          },
        })

        for (const s of settlements) {
          reply.raw.write(`event: settlement\ndata: ${JSON.stringify(s)}\n\n`)
          lastId = s.id
        }
      } catch (err) {
        logger.error({ err }, 'SSE polling error')
      }
    }, 3_000)

    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n')
    }, 30_000)

    request.socket.on('close', () => {
      clearInterval(interval)
      clearInterval(heartbeat)
      activeSseConnections--
      logger.debug({ activeSseConnections }, 'SSE client disconnected')
    })

    await new Promise(() => {})
  })
}
