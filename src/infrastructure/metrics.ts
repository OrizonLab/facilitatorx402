/**
 * Prometheus metrics registry — all application metrics defined here.
 *
 * Exported:
 *   - `registry`        — prom-client registry instance
 *   - `metrics`         — typed object with all metric instances
 *   - `collectMetrics`  — returns the full Prometheus text output
 */
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client'

export const registry = new Registry()

collectDefaultMetrics({ register: registry })

export const metrics = {
  // ─── HTTP latency ──────────────────────────────────────────────────────
  httpRequestDuration: new Histogram({
    name:       'http_request_duration_seconds',
    help:       'HTTP request latency p50/p95/p99 by route and status',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets:    [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers:  [registry],
  }),

  // ─── Verify ─────────────────────────────────────────────────────────
  verifyTotal: new Counter({
    name:       'facilitator_verify_total',
    help:       'Total verify requests by status',
    labelNames: ['status'] as const,  // accepted | rejected
    registers:  [registry],
  }),

  verifyDuplicatesBlocked: new Counter({
    name:      'facilitator_verify_duplicates_blocked_total',
    help:      'Verify requests blocked by anti-replay (nonce or sig hash duplicate)',
    registers: [registry],
  }),

  verifyDuration: new Histogram({
    name:      'facilitator_verify_duration_seconds',
    help:      'Verify handler duration (p50/p95)',
    buckets:   [0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
    registers: [registry],
  }),

  // ─── Settle ─────────────────────────────────────────────────────────
  settleTotal: new Counter({
    name:       'facilitator_settle_total',
    help:       'Total settle requests by status',
    labelNames: ['status'] as const,  // confirmed | failed | pending
    registers:  [registry],
  }),

  settleDuplicatesBlocked: new Counter({
    name:      'facilitator_settle_duplicates_blocked_total',
    help:      'Settle requests blocked by idempotence check',
    registers: [registry],
  }),

  settleDuration: new Histogram({
    name:      'facilitator_settle_duration_seconds',
    help:      'Settle handler duration end-to-end (including on-chain wait)',
    buckets:   [0.1, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
  }),

  // ─── Fees ───────────────────────────────────────────────────────────
  feeCollectedTotal: new Counter({
    name:       'facilitator_fee_collected_total_usdc_units',
    help:       'Cumulative platform fee collected in USDC base units',
    labelNames: ['asset', 'network'] as const,
    registers:  [registry],
  }),

  developerShareTotal: new Counter({
    name:       'facilitator_developer_share_total_usdc_units',
    help:       'Cumulative developer share reversed in USDC base units',
    labelNames: ['referral_code'] as const,
    registers:  [registry],
  }),

  // ─── Circuit breaker ────────────────────────────────────────────────
  rpcCircuitState: new Gauge({
    name:       'facilitator_rpc_circuit_state',
    help:       '1=CLOSED, 2=HALF-OPEN, 3=OPEN',
    labelNames: ['rpc'] as const,  // primary | fallback
    registers:  [registry],
  }),

  rpcCallsTotal: new Counter({
    name:       'facilitator_rpc_calls_total',
    help:       'Total RPC calls by outcome',
    labelNames: ['rpc', 'outcome'] as const,  // outcome: success | retried | failed
    registers:  [registry],
  }),

  // ─── Rate limiting ────────────────────────────────────────────────
  rateLimitHitsTotal: new Counter({
    name:       'facilitator_rate_limit_hits_total',
    help:       'Total rate limit rejections by endpoint',
    labelNames: ['endpoint'] as const,
    registers:  [registry],
  }),
}

export async function collectMetrics(): Promise<string> {
  return registry.metrics()
}

/** Update circuit breaker gauge — call after each RPC state change */
export function updateCircuitGauge(rpc: 'primary' | 'fallback', state: string): void {
  const val = state === 'CLOSED' ? 1 : state === 'HALF-OPEN' ? 2 : 3
  metrics.rpcCircuitState.set({ rpc }, val)
}
