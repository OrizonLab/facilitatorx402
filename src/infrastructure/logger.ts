/**
 * Pino structured logger — singleton.
 * In production: JSON output.
 * In development: pino-pretty for human-readable output.
 */
import pino from 'pino'
import { getConfig } from './config.js'

const config = getConfig()

export const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
  base: {
    service: 'facilitatorx402',
    version: process.env.npm_package_version ?? 'unknown',
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-admin-api-key"]',
      '*.apiKey',
      '*.privateKey',
      '*.secret',
      '*.apiKeyHash',
    ],
    censor: '[REDACTED]',
  },
})
