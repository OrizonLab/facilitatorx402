/**
 * Secrets management — strict env var validation at startup.
 *
 * Principle:
 *   - All secrets come from environment variables only.
 *   - Validated at boot with Zod; the service refuses to start if any secret is missing or malformed.
 *   - Never logged, never serialized in responses.
 *   - Provides a typed `Secrets` object consumed by the DI container.
 *
 * Rotation:
 *   - `RELAYER_PRIVATE_KEY`: rotate by updating the env var and restarting the service.
 *     Key change detection is logged at startup (key fingerprint — first 6 chars only).
 *   - `DATABASE_URL` / `REDIS_URL`: standard 12-factor rotation.
 *   - Future: support `RELAYER_PRIVATE_KEY_PREV` for zero-downtime rotation.
 */
import { z } from 'zod'

const HEX_64 = /^0x[0-9a-fA-F]{64}$/

const SecretsSchema = z.object({
  // Node
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT:     z.coerce.number().int().min(1).max(65535).default(3000),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL URL'),

  // Redis
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis URL'),

  // Blockchain relayer
  RELAYER_PRIVATE_KEY: z
    .string()
    .regex(HEX_64, 'RELAYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string'),

  // Network config
  SUPPORTED_NETWORK: z.string().min(1).default('base-mainnet'),
  SUPPORTED_ASSET:   z.string().min(1).default('USDC'),
  RPC_URL:           z.string().url('RPC_URL must be a valid URL'),
  RPC_URL_FALLBACK:  z.string().url().optional(),  // Optional failover RPC

  // Fee engine (ADR-002)
  FEE_BASIS_POINTS:    z.coerce.number().int().min(0).max(1000).default(50),
  DEVELOPER_SHARE_BPS: z.coerce.number().int().min(0).max(10000).default(2000),
  FREE_TIER_MONTHLY:   z.coerce.number().int().min(0).default(0),

  // Observability
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Service identity
  SERVICE_VERSION: z.string().default('0.1.0'),
})

export type Secrets = z.infer<typeof SecretsSchema>

let _secrets: Secrets | undefined

/**
 * Load and validate secrets from process.env.
 * Call once at startup — memoized after first call.
 * Throws if any required secret is missing or invalid.
 */
export function loadSecrets(): Secrets {
  if (_secrets) return _secrets

  const result = SecretsSchema.safeParse(process.env)

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`[secrets] Invalid environment:\n${issues}`)
  }

  _secrets = result.data

  // Log key fingerprint (never the full key)
  const keyFingerprint = _secrets.RELAYER_PRIVATE_KEY.slice(0, 8) + '...'
  process.stdout.write(
    `[secrets] Loaded — relayer key fingerprint: ${keyFingerprint}\n`,
  )

  return _secrets
}

/**
 * Reset memoized secrets (test utility only).
 */
export function _resetSecrets(): void {
  _secrets = undefined
}
