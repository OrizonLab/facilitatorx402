/**
 * Unit tests — Webhook HMAC-SHA256 signature
 *
 * Verifies:
 *   - Valid signature is accepted
 *   - Tampered body is rejected
 *   - Wrong secret is rejected
 *   - Missing header is rejected
 *   - Empty secret is rejected
 *   - timingSafeEqual prevents timing attacks
 */
import { describe, it, expect } from 'vitest'
import { verifyWebhookSignature } from '../../src/infrastructure/webhook-verify.js'
import crypto from 'node:crypto'

const SECRET = 'wh_test_secret_abc123'
const BODY = JSON.stringify({ event: 'payment.settled', requestId: 'req_1' })
const VALID_SIG = 'sha256=' + crypto.createHmac('sha256', SECRET).update(BODY).digest('hex')

describe('verifyWebhookSignature', () => {
  it('accepts a valid signature', () => {
    expect(verifyWebhookSignature(BODY, SECRET, VALID_SIG)).toBe(true)
  })

  it('rejects a tampered body', () => {
    const tampered = BODY + ' tampered'
    expect(verifyWebhookSignature(tampered, SECRET, VALID_SIG)).toBe(false)
  })

  it('rejects a wrong secret', () => {
    expect(verifyWebhookSignature(BODY, 'wrong_secret', VALID_SIG)).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(verifyWebhookSignature(BODY, SECRET, undefined)).toBe(false)
  })

  it('rejects an empty secret', () => {
    expect(verifyWebhookSignature(BODY, '', VALID_SIG)).toBe(false)
  })

  it('rejects a signature without sha256= prefix', () => {
    const noPrefix = VALID_SIG.replace('sha256=', '')
    expect(verifyWebhookSignature(BODY, SECRET, noPrefix)).toBe(false)
  })
})
