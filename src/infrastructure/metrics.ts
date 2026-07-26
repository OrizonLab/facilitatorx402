import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client'

export const register = new Registry()

collectDefaultMetrics({ register })

// ─── Latency histograms ─────────────────────────────────────────────────────────────────

export const verifyDuration = new Histogram({
  name: 'facilitator_verify_duration_seconds',
  help: 'Latency of POST /verify',
  labelNames: ['status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
})

export const settleDuration = new Histogram({
  name: 'facilitator_settle_duration_seconds',
  help: 'Latency of POST /settle',
  labelNames: ['status'] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
})

// ─── Counters ───────────────────────────────────────────────────────────────────────

export const requestsTotal = new Counter({
  name: 'facilitator_requests_total',
  help: 'Total number of requests per endpoint',
  labelNames: ['endpoint', 'status'] as const,
  registers: [register],
})

export const errorsTotal = new Counter({
  name: 'facilitator_errors_total',
  help: 'Total errors per endpoint and error code',
  labelNames: ['endpoint', 'code'] as const,
  registers: [register],
})

export const duplicateBlockedTotal = new Counter({
  name: 'facilitator_duplicate_blocked_total',
  help: 'Total duplicate payments blocked by anti-replay',
  registers: [register],
})

export const settlementsTotal = new Counter({
  name: 'facilitator_settlements_total',
  help: 'Total settlement attempts',
  labelNames: ['status'] as const,
  registers: [register],
})

export const commissionTotal = new Counter({
  name: 'facilitator_commission_total_units',
  help: 'Total commission collected in asset smallest unit',
  registers: [register],
})

export const developerShareTotal = new Counter({
  name: 'facilitator_developer_share_total_units',
  help: 'Total developer share in asset smallest unit',
  registers: [register],
})

// ─── Gauges ─────────────────────────────────────────────────────────────────────────

export const workerQueueDepth = new Gauge({
  name: 'facilitator_worker_queue_depth',
  help: 'Number of jobs waiting in the settlement queue',
  registers: [register],
})

export const workerActiveJobs = new Gauge({
  name: 'facilitator_worker_active_jobs',
  help: 'Number of active settlement worker jobs',
  registers: [register],
})
