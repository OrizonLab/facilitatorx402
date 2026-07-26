/**
 * Dashboard opérateur — Routes GET
 *
 * Endpoints disponibles :
 *
 *   GET /dashboard
 *       Interface HTML read-only du monitoring (rendu server-side)
 *       Auth : header Authorization: Bearer <DASHBOARD_TOKEN>
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
 *   - DASHBOARD_TOKEN env var obligatoire
 *   - Aucune donnée sensible exposée (pas de clés, pas de secrets)
 *   - Read-only — aucun endpoint de mutation
 *
 * Usage SSE (EventSource côté client) :
 *   const es = new EventSource('/dashboard/events', {
 *     headers: { Authorization: 'Bearer ' + token }
 *   })
 *   es.addEventListener('settlement', (e) => console.log(JSON.parse(e.data)))
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../../infrastructure/prisma.js'
import { logger } from '../../infrastructure/logger.js'

const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN ?? ''

// ── Auth middleware ──────────────────────────────────────────────────────────

function assertDashboardAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!DASHBOARD_TOKEN) {
    reply.status(503).send({ error: 'Dashboard not configured (DASHBOARD_TOKEN missing)' })
    return false
  }
  const auth = request.headers['authorization'] ?? ''
  const token = auth.replace('Bearer ', '').trim()
  if (token !== DASHBOARD_TOKEN) {
    reply.status(401).send({ error: 'Unauthorized' })
    return false
  }
  return true
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export async function dashboardRoutes(app: FastifyInstance) {

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

    const query = request.query as any
    const page = Math.max(1, parseInt(query.page ?? '1'))
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20')))
    const skip = (page - 1) * limit

    const where: any = {}
    if (query.status) where.settlementStatus = query.status
    if (query.network) {
      where.request = { network: { name: query.network } }
    }

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
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  })

  // GET /dashboard/api/webhooks — Paginated webhook delivery table
  app.get('/dashboard/api/webhooks', async (request, reply) => {
    if (!assertDashboardAuth(request, reply)) return

    const query = request.query as any
    const page = Math.max(1, parseInt(query.page ?? '1'))
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20')))
    const skip = (page - 1) * limit

    const where: any = {}
    if (query.status) where.status = query.status
    if (query.event) where.event = query.event

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

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    })

    // Send initial ping
    reply.raw.write('event: connected\ndata: {"status":"connected"}\n\n')

    // Poll DB every 3s and push new settlements
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

    // Heartbeat every 30s to prevent proxy timeout
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n')
    }, 30_000)

    request.socket.on('close', () => {
      clearInterval(interval)
      clearInterval(heartbeat)
      logger.debug('SSE client disconnected')
    })

    // Never resolve — keep connection open
    await new Promise(() => {})
  })
}
