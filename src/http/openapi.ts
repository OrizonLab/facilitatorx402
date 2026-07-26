import type { FastifyInstance } from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'facilitatorx402 API',
        description: [
          'Self-hosted x402 payment facilitator.',
          '',
          '## Usage',
          'All endpoints accept and return `application/json`.',
          'Errors follow a stable error model with a `code`, `reason`, and `message`.',
          '',
          '## Authentication',
          'Seller endpoints require an `Authorization: Bearer <apiKey>` header.',
          'API keys are provisioned via `POST /sellers/register`.',
        ].join('\n'),
        version: '1.1.0',
        contact: { name: 'OrizonLab', url: 'https://github.com/OrizonLab/facilitatorx402' },
        license: { name: 'MIT' },
      },
      servers: [
        { url: 'http://localhost:3000', description: 'Local development' },
        { url: 'https://facilitator.orizonlab.io', description: 'Production' },
      ],
      tags: [
        { name: 'operator', description: 'Observability and status endpoints' },
        { name: 'payments', description: 'Payment verification and settlement' },
        { name: 'sellers', description: 'Seller registration and API key management' },
        { name: 'webhooks', description: 'Webhook subscription management' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'API Key',
          },
        },
        schemas: {
          ErrorResponse: {
            type: 'object',
            required: ['code', 'reason', 'message'],
            properties: {
              code: { type: 'string', example: 'invalid_signature' },
              reason: { type: 'string', example: 'Signature verification failed' },
              message: { type: 'string', example: 'The provided signature does not match the expected signer' },
              correlationId: { type: 'string', example: '01J3XKZP000000000000000000' },
            },
          },
          Receipt: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              requestId: { type: 'string' },
              protocolVersion: { type: 'string', example: '1' },
              status: { type: 'string', enum: ['confirmed', 'failed'] },
              txHash: { type: 'string', example: '0xabc...' },
              feeAmount: { type: 'string', example: '100' },
              developerShare: { type: 'string', example: '20' },
              confirmedAt: { type: 'string', format: 'date-time' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      persistAuthorization: true,
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
    logo: {
      type: 'image/svg+xml',
      content: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#01696f"/><text x="50" y="65" font-size="48" text-anchor="middle" fill="white" font-family="monospace">x</text></svg>'
      ).toString('base64'),
    },
  })

  app.log.info('OpenAPI docs available at /docs')
}
