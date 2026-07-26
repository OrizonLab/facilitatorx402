/**
 * Prometheus metrics registry — all counters, histograms and gauges for V1.
 *
 * Import and call these helpers from service layer:
 *   metrics.verifyTotal.inc({ status: 'accepted' })
 *   metrics.settleDuration.observe(elapsedSeconds)
 *
 * Default metrics (CPU, memory, event loop lag) are collected automatically
 * via prom-client collectDefaultMetrics().
 */
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from 'prom-client'

export const register = new Registry()

collectDefaultMetrics({ register })

// ─── HTTP ───────────────────────────────────────────────────────────────────
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
})

// ─── VERIFY ─────────────────────────────────────────────────────────────────
export const verifyTotal = new Counter({
  name: 'verify_total',
  help: 'Total verify requests by status',
  labelNames: ['status'], // accepted | rejected
  registers: [register],
})

export const verifyDuration = new Histogram({
  name: 'verify_duration_seconds',
  help: 'Verify pipeline latency in seconds (p50/p95)',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
})

// ─── SETTLE ─────────────────────────────────────────────────────────────────
export const settleTotal = new Counter({
  name: 'settle_total',
  help: 'Total settle requests by status',
  labelNames: ['status'], // confirmed | failed | pending
  registers: [register],
})

export const settleDuration = new Histogram({
  name: 'settle_duration_seconds',
  help: 'Settle pipeline latency in seconds (p50/p95)',
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
})

// ─── ANTI-REPLAY / DUPLICATES ───────────────────────────────────────────────
export const duplicateBlockedTotal = new Counter({
  name: 'duplicate_blocked_total',
  help: 'Total duplicate payments blocked by anti-replay',
  labelNames: ['type'], // nonce | signature | settlement
  registers: [register],
})

// ─── COMMISSION ─────────────────────────────────────────────────────────────
export const commissionGeneratedTotal = new Counter({
  name: 'commission_generated_total',
  help: 'Total platform commission generated (asset smallest unit)',
  registers: [register],
})

export const developerShareTotal = new Counter({
  name: 'developer_share_total',
  help: 'Total developer share paid out (asset smallest unit)',
  registers: [register],
})

// ─── WORKER / QUEUE ─────────────────────────────────────────────────────────
export const bullmqQueueDepth = new Gauge({
  name: 'bullmq_queue_depth',
  help: 'Current number of jobs waiting in BullMQ queue',
  labelNames: ['queue'],
  registers: [register],
})

// ─── RPC ────────────────────────────────────────────────────────────────────
export const rpcErrorsTotal = new Counter({
  name: 'rpc_errors_total',
  help: 'Total RPC errors (primary + fallback)',
  labelNames: ['rpc_url'],
  registers: [register],
})

export const metrics = {
  httpRequestDuration,
  verifyTotal,
  verifyDuration,
  settleTotal,
  settleDuration,
  duplicateBlockedTotal,
  commissionGeneratedTotal,
  developerShareTotal,
  bullmqQueueDepth,
  rpcErrorsTotal,
}
