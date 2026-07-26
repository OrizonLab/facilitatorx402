import { z } from 'zod'

const configSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SERVICE_VERSION: z.string().default('1.0.0'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Blockchain
  RPC_URL: z.string().url(),
  RPC_URL_FALLBACK: z.string().url().optional(),
  FACILITATOR_PRIVATE_KEY: z.string().min(64),
  FACILITATOR_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),

  // Network & Asset
  SUPPORTED_CHAIN_ID: z.coerce.number().int().positive(),
  SUPPORTED_ASSET_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  SUPPORTED_ASSET_SYMBOL: z.string().min(1),
  SUPPORTED_ASSET_DECIMALS: z.coerce.number().int().min(0).max(18),

  // Fee Engine
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10000).default(50),
  DEVELOPER_SHARE_PERCENT: z.coerce.number().int().min(0).max(100).default(20),
  FREE_MONTHLY_VOLUME: z.coerce.bigint().default(0n),

  // Security
  RATE_LIMIT_VERIFY: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_SETTLE: z.coerce.number().int().positive().default(50),
  RATE_LIMIT_GLOBAL: z.coerce.number().int().positive().default(500),
  CLOCK_SKEW_TOLERANCE_SECONDS: z.coerce.number().int().min(0).default(30),

  // Settlement
  CONFIRMATIONS_REQUIRED: z.coerce.number().int().min(1).default(1),
  SETTLEMENT_TIMEOUT_SECONDS: z.coerce.number().int().min(10).default(120),
  SETTLE_LOCK_TTL_SECONDS: z.coerce.number().int().min(10).default(60),
  RPC_MAX_RETRIES: z.coerce.number().int().min(1).default(3),
  RPC_CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().min(1).default(3),
  RPC_CIRCUIT_BREAKER_COOLDOWN_SECONDS: z.coerce.number().int().min(5).default(30),
})

export type Config = z.infer<typeof configSchema>

function loadConfig(): Config {
  const result = configSchema.safeParse(process.env)
  if (!result.success) {
    console.error('\u274C Invalid configuration:')
    console.error(result.error.format())
    process.exit(1)
  }
  return result.data
}

export const config = loadConfig()
