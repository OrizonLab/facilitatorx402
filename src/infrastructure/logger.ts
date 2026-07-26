/**
 * Structured logger — pino.
 *
 * All logs include:
 *   - level
 *   - timestamp (ISO)
 *   - service name
 *   - environment
 *
 * Usage:
 *   logger.info({ requestId, settlementId }, 'settlement confirmed')
 *   logger.error({ err }, 'unexpected error')
 *   logger.child({ requestId }).info('verify accepted')
 *
 * In production, logs are newline-delimited JSON.
 * In development, pretty-print is enabled.
 *
 * Redacted fields (never appear in log output):
 *   - FACILITATOR_PRIVATE_KEY, DATABASE_URL, REDIS_URL, METRICS_TOKEN
 *   - req.headers.authorization (Bearer tokens)
 *   - Any nested *.authorization, *.password, *.secret, *.privateKey
 */
import pino from 'pino'
import { getConfig } from './config.js'

function createLogger() {
  const config = getConfig()
  const isDev = config.NODE_ENV === 'development'

  return pino({
    level: config.LOG_LEVEL,
    base: {
      service: 'facilitatorx402',
      env: config.NODE_ENV,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
    redact: [
      // Top-level env secrets
      'FACILITATOR_PRIVATE_KEY',
      'DATABASE_URL',
      'REDIS_URL',
      'METRICS_TOKEN',
      // HTTP request headers
      'req.headers.authorization',
      'req.headers["x-admin-api-key"]',
      // Nested object patterns (catch-all for deep objects)
      '*.authorization',
      '*.password',
      '*.secret',
      '*.privateKey',
      '*.apiKey',
      '*.api_key',
    ],
  })
}

export const logger = createLogger()
