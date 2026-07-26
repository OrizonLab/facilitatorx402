/**
 * Webhook secret encryption at rest — AES-256-GCM.
 *
 * Webhook signing secrets are sensitive: they allow an attacker who reads the
 * DB to forge webhook signatures. We encrypt them before storing and decrypt
 * on read so the DB never contains plaintext secrets.
 *
 * Algorithm : AES-256-GCM
 *   - Key     : 32-byte random key from WEBHOOK_ENCRYPTION_KEY env var (hex)
 *   - IV      : 12-byte random per-encryption (stored alongside ciphertext)
 *   - Auth tag: 16-byte GCM tag (integrity + authenticity)
 *
 * Stored format (Base64-encoded JSON): { iv, tag, data }
 *
 * Environment variable:
 *   WEBHOOK_ENCRYPTION_KEY=<64 hex chars = 32 bytes>
 *   Generate: openssl rand -hex 32
 *
 * If WEBHOOK_ENCRYPTION_KEY is not set, the module throws at first use —
 * fail loudly rather than silently storing plaintext.
 */
import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12   // GCM recommended IV length
const TAG_LENGTH = 16  // GCM auth tag length (bytes)

function getEncryptionKey(): Buffer {
  const hex = process.env.WEBHOOK_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error(
      'WEBHOOK_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes). ' +
      'Generate with: openssl rand -hex 32'
    )
  }
  return Buffer.from(hex, 'hex')
}

export interface EncryptedWebhookSecret {
  /** Base64-encoded ciphertext envelope: JSON { iv, tag, data } */
  ciphertext: string
}

/**
 * Encrypt a plaintext webhook secret for storage.
 * Returns a Base64-encoded envelope string safe to store in a TEXT column.
 */
export function encryptWebhookSecret(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  })

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  const envelope = {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  }

  return Buffer.from(JSON.stringify(envelope)).toString('base64')
}

/**
 * Decrypt a stored webhook secret.
 * Throws if the key is wrong, the tag is invalid, or the envelope is malformed.
 */
export function decryptWebhookSecret(ciphertext: string): string {
  const key = getEncryptionKey()

  let envelope: { iv: string; tag: string; data: string }
  try {
    envelope = JSON.parse(Buffer.from(ciphertext, 'base64').toString('utf8'))
  } catch {
    throw new Error('Invalid webhook secret envelope — cannot parse JSON')
  }

  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const data = Buffer.from(envelope.data, 'base64')

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  })
  decipher.setAuthTag(tag)

  try {
    return decipher.update(data).toString('utf8') + decipher.final('utf8')
  } catch {
    throw new Error(
      'Webhook secret decryption failed — wrong key or tampered ciphertext'
    )
  }
}

/**
 * Returns true if a string looks like an encrypted envelope (Base64 JSON with iv/tag/data).
 * Used to detect legacy plaintext secrets and migrate them.
 */
export function isEncryptedEnvelope(value: string): boolean {
  try {
    const obj = JSON.parse(Buffer.from(value, 'base64').toString('utf8'))
    return typeof obj.iv === 'string' && typeof obj.tag === 'string' && typeof obj.data === 'string'
  } catch {
    return false
  }
}
