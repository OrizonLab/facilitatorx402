import { z } from 'zod'

const ConfigSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // PostgreSQL — mandatory, no fallback to SQLite
  DATABASE_URL: z.string().url().refine(
    (url) => url.startsWith('postgresql://') || url.startsWith('postgres://'),
    { message: 'DATABASE_URL must be a PostgreSQL connection string (postgresql:// or postgres://)' }
  ),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Blockchain
  RPC_URL: z.string().url(),
  RPC_URL_TESTNET: z.string().url().optional(),
  FACILITATOR_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Must be a 0x-prefixed 64-char hex private key'),

  // x402 config
  SUPPORTED_NETWORK: z.string().default('base-mainnet'),
  SUPPORTED_ASSET: z.string().default('USDC'),
  SUPPORTED_CHAIN_ID: z.coerce.number().default(8453),
  MIN_CONFIRMATIONS: z.coerce.number().default(1),

  // Fee engine
  PLATFORM_FEE_BPS: z.coerce.number().min(0).max(1000).default(50), // 0.5%
  DEVELOPER_SHARE_BPS: z.coerce.number().min(0).max(1000).default(20), // 0.2%

  // Security
  ADMIN_API_KEY: z.string().min(32).optional(),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
})

export type Config = z.infer<typeof ConfigSchema>

let config: Config | null = null

export function getConfig(): Config {
  if (!config) {
    const result = ConfigSchema.safeParse(process.env)
    if (!result.success) {
      const errors = result.error.errors.map((e) => `  ${e.path.join('.')}: ${e.message}`).join('\n')
      throw new Error(`Configuration error (PostgreSQL required):\n${errors}`)
    }
    config = result.data
  }
  return config
}

export function resetConfig(): void {
  config = null
}
