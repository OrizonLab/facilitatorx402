/**
 * OAuth2 Device Authorization Grant (RFC 8628)
 *
 * Enables autonomous devices (domestic robots, IoT) to authenticate
 * without a browser. The device displays a code; the user authorizes
 * on mobile/desktop; the device receives an access token.
 *
 * Flow:
 * 1. Robot calls POST /device/authorize → receives device_code + user_code
 * 2. Robot polls GET /device/token with device_code
 * 3. User visits /device/activate and enters the user_code on their phone
 * 4. Robot receives access_token + API key on next poll
 *
 * Standard: RFC 8628 — https://datatracker.ietf.org/doc/html/rfc8628
 */
import type { FastifyInstance } from 'fastify'
import crypto from 'node:crypto'
import { generateApiKey } from '../../infrastructure/api-key.js'
import { logger } from '../../infrastructure/logger.js'

// In-memory store for the flow (replace with Redis in production)
const pendingDevices = new Map<string, {
  userCode: string
  deviceCode: string
  expiresAt: number
  approved: boolean
  apiKey?: string
}>()

function generateUserCode(): string {
  // Human-readable: 8 chars, no ambiguous chars (0/O, 1/I/l)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('') +
    '-' +
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function registerDeviceAuthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /device/authorize
   * Step 1: Device requests a code pair.
   */
  app.post('/device/authorize', {
    schema: {
      tags: ['sellers'],
      summary: 'OAuth2 Device Flow — request device + user code (RFC 8628)',
      description: [
        'Start the OAuth2 Device Authorization flow.',
        '',
        'The device (robot, IoT) calls this endpoint and receives a `user_code`.',
        'The device displays the code and the `verification_uri` to the user.',
        'The user visits the URI on their phone and approves the device.',
        'The device polls `POST /device/token` until it receives an API key.',
        '',
        '**This is the recommended authentication flow for robots and IoT devices.**',
      ].join('\n'),
      body: {
        type: 'object',
        properties: {
          deviceName: { type: 'string', example: 'Home Robot v2' },
          deviceType: { type: 'string', enum: ['robot', 'iot', 'agent', 'server'], default: 'robot' },
        },
      },
    },
  }, async (request, reply) => {
    const { deviceName = 'unknown device', deviceType = 'robot' } = (request.body ?? {}) as Record<string, string>

    const deviceCode = crypto.randomBytes(32).toString('hex')
    const userCode = generateUserCode()
    const expiresAt = Date.now() + 10 * 60 * 1000 // 10 minutes

    pendingDevices.set(deviceCode, { userCode, deviceCode, expiresAt, approved: false })

    logger.info({ deviceType, userCode }, 'device authorization initiated')

    const baseUrl = `${request.protocol}://${request.hostname}`

    return reply.status(200).send({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${baseUrl}/device/activate`,
      verification_uri_complete: `${baseUrl}/device/activate?code=${userCode}`,
      expires_in: 600,
      interval: 5,
    })
  })

  /**
   * POST /device/token
   * Step 2: Device polls until approved.
   */
  app.post('/device/token', {
    schema: {
      tags: ['sellers'],
      summary: 'OAuth2 Device Flow — poll for API key',
      body: {
        type: 'object',
        required: ['device_code'],
        properties: {
          device_code: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { device_code } = request.body as { device_code: string }
    const pending = pendingDevices.get(device_code)

    if (!pending) {
      return reply.status(400).send({ error: 'invalid_grant', error_description: 'Unknown device code' })
    }

    if (Date.now() > pending.expiresAt) {
      pendingDevices.delete(device_code)
      return reply.status(400).send({ error: 'expired_token', error_description: 'Device code expired' })
    }

    if (!pending.approved) {
      return reply.status(400).send({ error: 'authorization_pending', error_description: 'Waiting for user approval' })
    }

    // Approved — generate API key
    const { raw: apiKey } = generateApiKey()
    pendingDevices.delete(device_code)

    return reply.send({
      access_token: apiKey,
      token_type: 'bearer',
      message: 'Use this as Authorization: Bearer <access_token> on all requests',
    })
  })

  /**
   * POST /device/activate
   * Step 3: User approves the device (called from the user's browser/mobile).
   */
  app.post('/device/activate', {
    schema: {
      tags: ['sellers'],
      summary: 'OAuth2 Device Flow — user activates device',
      body: {
        type: 'object',
        required: ['user_code'],
        properties: {
          user_code: { type: 'string', example: 'ABCD-EFGH' },
        },
      },
    },
  }, async (request, reply) => {
    const { user_code } = request.body as { user_code: string }

    const pending = [...pendingDevices.values()].find((p) => p.userCode === user_code)
    if (!pending || Date.now() > pending.expiresAt) {
      return reply.status(400).send({ code: 'invalid_code', message: 'Invalid or expired user code' })
    }

    pending.approved = true
    logger.info({ userCode: user_code }, 'device activation approved')

    return reply.send({ message: 'Device activated. It will receive its API key on the next poll.' })
  })
}
