/**
 * Latency benchmark — Phase 7
 *
 * Measures p50/p95/p99 for:
 *   - POST /verify  (with mock signature, no on-chain)
 *   - POST /settle  (idempotent call — measures overhead without on-chain)
 *   - GET  /health
 *   - GET  /supported
 *
 * Usage:
 *   FACILITATOR_URL=http://localhost:3000 pnpm ts-node scripts/benchmark.ts
 */
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'http://localhost:3000'
const ITERATIONS      = Number(process.env.BENCH_ITER ?? 100)

type Percentiles = { p50: number; p95: number; p99: number; min: number; max: number; mean: number }

function percentiles(samples: number[]): Percentiles {
  const sorted = [...samples].sort((a, b) => a - b)
  const p = (pct: number) => sorted[Math.ceil((pct / 100) * sorted.length) - 1]!
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  return { p50: p(50), p95: p(95), p99: p(99), min: sorted[0]!, max: sorted[sorted.length - 1]!, mean: Math.round(mean) }
}

async function measureEndpoint(
  label: string,
  fn: () => Promise<void>,
  n = ITERATIONS,
): Promise<void> {
  const samples: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    await fn()
    samples.push(Math.round(performance.now() - t0))
  }
  const p = percentiles(samples)
  console.log(
    `  ${label.padEnd(30)} p50=${p.p50}ms  p95=${p.p95}ms  p99=${p.p99}ms  mean=${p.mean}ms  min=${p.min}ms  max=${p.max}ms`
  )
}

const MOCK_VERIFY_BODY = {
  version:        '1',
  scheme:         'exact',
  network:        'base-mainnet',
  asset:          'USDC',
  invoiceId:      `bench_${Date.now()}`,
  requiredAmount: '1000000',
  recipient:      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  payload: {
    signature: '0x' + 'a'.repeat(130),
    authorization: {
      from:        '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      to:          '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      value:       '1000000',
      validAfter:  0,
      validBefore: Math.floor(Date.now() / 1000) + 3600,
      nonce:       '0x' + 'b'.repeat(64),
    },
  },
}

async function main() {
  console.log(`\n📊 Benchmark — ${ITERATIONS} iterations — ${FACILITATOR_URL}\n`)

  // Health (baseline)
  await measureEndpoint('GET /health', async () => {
    await fetch(`${FACILITATOR_URL}/health`)
  })

  // Supported
  await measureEndpoint('GET /supported', async () => {
    await fetch(`${FACILITATOR_URL}/supported`)
  })

  // Verify (expect rejection — measures full handler path sans on-chain)
  let idx = 0
  await measureEndpoint('POST /verify (rejected)', async () => {
    await fetch(`${FACILITATOR_URL}/verify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...MOCK_VERIFY_BODY, invoiceId: `bench_${Date.now()}_${idx++}` }),
    })
  })

  // Settle idempotent (non-existent requestId — measures handler overhead)
  await measureEndpoint('POST /settle (not_found)', async () => {
    await fetch(`${FACILITATOR_URL}/settle`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ paymentRequestId: 'bench_nonexistent_' + Math.random() }),
    })
  })

  console.log('\n✅ Benchmark complete.\n')
  console.log('Targets V1 :')
  console.log('  /health    p95 < 5ms')
  console.log('  /verify    p95 < 50ms  (signature verify + DB write)')
  console.log('  /settle    p95 < 5s   (on-chain confirm — not benchmarkable offline)')
}

main().catch(console.error)
