import type { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import { getConfig } from '../../infrastructure/config.js';

export async function registerCors(app: FastifyInstance): Promise<void> {
  const config = getConfig();

  await app.register(fastifyCors, {
    origin: config.CORS_ORIGINS
      ? config.CORS_ORIGINS.split(',').map((o) => o.trim())
      : false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Api-Key'],
    exposedHeaders: ['X-Request-Id', 'X-Correlation-Id'],
    credentials: false,
    maxAge: 86400,
  });
}
