/**
 * Key Provider — KMS/Vault abstraction for FACILITATOR_PRIVATE_KEY.
 *
 * The facilitator signs settlement transactions with a private key.
 * In production, this key must never live in plaintext in environment
 * variables. This module provides a pluggable abstraction:
 *
 *   PRIVATE_KEY_PROVIDER=env     (default) — reads FACILITATOR_PRIVATE_KEY from env
 *   PRIVATE_KEY_PROVIDER=awskms  — decrypts FACILITATOR_PRIVATE_KEY_CIPHERTEXT via AWS KMS
 *   PRIVATE_KEY_PROVIDER=vault   — fetches the key from HashiCorp Vault KV v2
 *
 * The resolved private key is cached in memory after the first call.
 * It is NEVER logged or serialized.
 *
 * Usage:
 *   import { getPrivateKey } from './key-provider.js'
 *   const privateKey = await getPrivateKey() // `0x${string}`
 *
 * Environment variables per provider:
 *
 *   env (default):
 *     FACILITATOR_PRIVATE_KEY=0x...
 *
 *   awskms:
 *     AWS_REGION=us-east-1
 *     KMS_KEY_ID=arn:aws:kms:...
 *     FACILITATOR_PRIVATE_KEY_CIPHERTEXT=<base64 KMS-encrypted key>
 *
 *   vault:
 *     VAULT_ADDR=https://vault.example.com
 *     VAULT_TOKEN=s.xxxxx  (or VAULT_ROLE_ID + VAULT_SECRET_ID for AppRole)
 *     VAULT_SECRET_PATH=secret/data/facilitatorx402/private-key
 *     VAULT_SECRET_FIELD=private_key
 */
import { logger } from './logger.js'

type Provider = 'env' | 'awskms' | 'vault'

let _cachedKey: `0x${string}` | null = null

/**
 * Returns the facilitator private key as a `0x`-prefixed hex string.
 * Cached after first resolution.
 */
export async function getPrivateKey(): Promise<`0x${string}`> {
  if (_cachedKey) return _cachedKey

  const provider = (process.env.PRIVATE_KEY_PROVIDER ?? 'env') as Provider
  logger.info({ provider }, 'Resolving facilitator private key')

  switch (provider) {
    case 'env':
      _cachedKey = resolveFromEnv()
      break
    case 'awskms':
      _cachedKey = await resolveFromAwsKms()
      break
    case 'vault':
      _cachedKey = await resolveFromVault()
      break
    default:
      throw new Error(`Unknown PRIVATE_KEY_PROVIDER: ${provider}. Valid values: env, awskms, vault`)
  }

  return _cachedKey
}

/**
 * Invalidate the cached key (e.g., after a rotation event).
 */
export function invalidateKeyCache(): void {
  _cachedKey = null
  logger.info('Private key cache invalidated — will re-fetch on next call')
}

// ─── Providers ────────────────────────────────────────────────────────────────

function resolveFromEnv(): `0x${string}` {
  const raw = process.env.FACILITATOR_PRIVATE_KEY
  if (!raw) {
    throw new Error('FACILITATOR_PRIVATE_KEY is not set. Required when PRIVATE_KEY_PROVIDER=env.')
  }
  const key = raw.startsWith('0x') ? raw : `0x${raw}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('FACILITATOR_PRIVATE_KEY must be a 32-byte hex string (64 hex chars, optionally prefixed with 0x)')
  }
  return key as `0x${string}`
}

async function resolveFromAwsKms(): Promise<`0x${string}`> {
  // Lazy import — @aws-sdk/client-kms is an optional peer dependency.
  // Install with: npm install @aws-sdk/client-kms
  let KMSClient: any, DecryptCommand: any
  try {
    const mod = await import('@aws-sdk/client-kms')
    KMSClient = mod.KMSClient
    DecryptCommand = mod.DecryptCommand
  } catch {
    throw new Error(
      'PRIVATE_KEY_PROVIDER=awskms requires @aws-sdk/client-kms. ' +
      'Install with: npm install @aws-sdk/client-kms'
    )
  }

  const region = process.env.AWS_REGION
  const keyId = process.env.KMS_KEY_ID
  const ciphertextB64 = process.env.FACILITATOR_PRIVATE_KEY_CIPHERTEXT

  if (!region || !keyId || !ciphertextB64) {
    throw new Error(
      'PRIVATE_KEY_PROVIDER=awskms requires: AWS_REGION, KMS_KEY_ID, FACILITATOR_PRIVATE_KEY_CIPHERTEXT'
    )
  }

  const client = new KMSClient({ region })
  const ciphertext = Buffer.from(ciphertextB64, 'base64')

  const response = await client.send(
    new DecryptCommand({
      KeyId: keyId,
      CiphertextBlob: ciphertext,
    })
  )

  if (!response.Plaintext) {
    throw new Error('AWS KMS DecryptCommand returned no plaintext')
  }

  const plaintext = Buffer.from(response.Plaintext).toString('utf8').trim()
  const key = plaintext.startsWith('0x') ? plaintext : `0x${plaintext}`

  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('KMS decrypted value is not a valid 32-byte private key')
  }

  logger.info({ keyId }, 'Private key resolved from AWS KMS')
  return key as `0x${string}`
}

async function resolveFromVault(): Promise<`0x${string}`> {
  const addr = process.env.VAULT_ADDR
  const token = process.env.VAULT_TOKEN
  const secretPath = process.env.VAULT_SECRET_PATH ?? 'secret/data/facilitatorx402/private-key'
  const field = process.env.VAULT_SECRET_FIELD ?? 'private_key'

  if (!addr) throw new Error('PRIVATE_KEY_PROVIDER=vault requires VAULT_ADDR')

  // Resolve Vault token: static token or AppRole auth
  const vaultToken = token ?? (await vaultAppRoleLogin(addr))

  const url = `${addr}/v1/${secretPath}`
  const response = await fetch(url, {
    headers: {
      'X-Vault-Token': vaultToken,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Vault KV read failed: HTTP ${response.status} at ${secretPath}`)
  }

  const json = await response.json() as { data?: { data?: Record<string, string> } }
  const plaintext = json.data?.data?.[field]

  if (!plaintext) {
    throw new Error(`Vault secret at '${secretPath}' does not contain field '${field}'`)
  }

  const key = plaintext.startsWith('0x') ? plaintext : `0x${plaintext}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('Vault secret is not a valid 32-byte private key')
  }

  logger.info({ secretPath, field }, 'Private key resolved from HashiCorp Vault')
  return key as `0x${string}`
}

/** AppRole login — returns a Vault client token */
async function vaultAppRoleLogin(addr: string): Promise<string> {
  const roleId = process.env.VAULT_ROLE_ID
  const secretId = process.env.VAULT_SECRET_ID

  if (!roleId || !secretId) {
    throw new Error(
      'PRIVATE_KEY_PROVIDER=vault without VAULT_TOKEN requires VAULT_ROLE_ID and VAULT_SECRET_ID'
    )
  }

  const response = await fetch(`${addr}/v1/auth/approle/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role_id: roleId, secret_id: secretId }),
  })

  if (!response.ok) {
    throw new Error(`Vault AppRole login failed: HTTP ${response.status}`)
  }

  const json = await response.json() as { auth?: { client_token?: string } }
  const clientToken = json.auth?.client_token

  if (!clientToken) throw new Error('Vault AppRole login returned no client_token')

  logger.info('Vault AppRole login successful')
  return clientToken
}
