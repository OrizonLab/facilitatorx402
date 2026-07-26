/**
 * Config — validated at startup via Zod.
 *
 * The process exits immediately if any required env var is missing or invalid.
 * This ensures the service never starts in a broken configuration state.
 *
 * Security notes:
 *   - METRICS_TOKEN, DASHBOARD_TOKEN, ADMIN_API_KEY are required in production (min 32 chars)
 *   - In development/test they may be shorter but must be explicitly set
 *   - FACILITATOR_PRIVATE_KEY must be 0x-prefixed 64-char hex
 *
 * Usage:
 *   import { getConfig } from './config.js'
 *   const cfg = getConfig()
 */
import { z } from 'zod'

/**
 * Require a minimum length in production, allow shorter in dev/test.
 * Provides a clear error message so operators know exactly what to fix.
 */
function secureToken(name: string, minLen = 32) {
  return z
    .string()
    .min(1, `${name} is required`)
    .refine(
      (val) => {
        const env = process.env.NODE_ENV ?? 'development'
        if (env === 'production') return val.length >= minLen
        return true
      },
      { message: `${name} must be at least ${minLen} characters in production` }
    )
}

const ConfigSchema = z.object({
  // ── Database ─────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url().min(1),

  // ── Redis ───────────────────────────────────────────────────────────
  REDIS_URL: z.string().min(1),

  // ── Blockchain ──────────────────────────────────────────────────────
  FACILITATOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'Must be a 0x-prefixed 32-byte hex string'),

  RPC_URL: z.string().url(),
  RPC_URL_FALLBACK: z.string().optional().default(''),
  MIN_CONFIRMATIONS: z.coerce.number().int().min(1).max(10).default(2),
  RPC_CALL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),

  // ── Circuit Breaker ──────────────────────────────────────────────────
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).default(5),
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),

  // ── Fee engine ──────────────────────────────────────────────────────
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(50),
  DEVELOPER_SHARE_BPS: z.coerce.number().int().min(0).max(10_000).default(20),

  // ── HTTP server ─────────────────────────────────────────────────────
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // ── Rate limiting ────────────────────────────────────────────────────
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_GLOBAL: z.coerce.number().int().min(1).default(200),
  RATE_LIMIT_SELLER_VERIFY: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_SELLER_SETTLE: z.coerce.number().int().min(1).default(30),

  // ── Security ───────────────────────────────────────────────────────────
  // These three tokens are REQUIRED — the service will refuse to start without them.
  // In production: must be at least 32 characters (enforce via secureToken).
  METRICS_TOKEN: secureToken('METRICS_TOKEN'),
  DASHBOARD_TOKEN: secureToken('DASHBOARD_TOKEN'),
  ADMIN_API_KEY: secureToken('ADMIN_API_KEY'),

  // ── Logging ───────────────────────────────────────────────────────────
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),

  // ── Environment ───────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Config = z.infer<typeof ConfigSchema>

let _config: Config | null = null

export function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env)
  if (!result.success) {
    const issues = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n')
    console.error(`[config] Invalid environment variables:\n${issues}`)
    process.exit(1)
  }
  _config = result.data
  return _config
}

export function getConfig(): Config {
  if (!_config) return loadConfig()
  return _config
}

// Alias pratique — compat avec les imports existants `import { config }`
export const config = new Proxy({} as Config, {
  get(_target, prop: string) {
    return getConfig()[prop as keyof Config]
  },
})
