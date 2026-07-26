/**
 * Config — validated at startup via Zod.
 *
 * The process exits immediately if any required env var is missing or invalid.
 * This ensures the service never starts in a broken configuration state.
 *
 * Usage:
 *   import { getConfig } from './config.js'
 *   const { DATABASE_URL, FACILITATOR_PRIVATE_KEY } = getConfig()
 */
import { z } from 'zod'

const ConfigSchema = z.object({
  // Database
  DATABASE_URL: z.string().url().min(1),

  // Redis
  REDIS_URL: z.string().min(1),

  // Blockchain
  FACILITATOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'FACILITATOR_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string'),

  RPC_URL: z.string().url(),
  RPC_URL_FALLBACK: z.string().optional().default(''),
  MIN_CONFIRMATIONS: z.coerce.number().int().min(1).max(10).default(2),

  // Fee engine
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(50),
  DEVELOPER_SHARE_BPS: z.coerce.number().int().min(0).max(10_000).default(20),

  // HTTP server
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),

  // Security
  METRICS_TOKEN: z.string().optional().default(''),

  // Logging
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),

  // Environment
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
  if (!_config) {
    return loadConfig()
  }
  return _config
}
