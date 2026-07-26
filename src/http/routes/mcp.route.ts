/**
 * GET /.well-known/mcp
 *
 * Model Context Protocol (MCP) manifest.
 * Allows AI agents (Claude, GPT, etc.) to discover and use the facilitator
 * as a native tool without any custom integration code.
 *
 * Standard: https://modelcontextprotocol.io
 */
import type { FastifyInstance } from 'fastify'

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  app.get('/.well-known/mcp', {
    schema: {
      tags: ['operator'],
      summary: 'MCP manifest for AI agent tool discovery',
      description: [
        'Returns a Model Context Protocol (MCP) manifest.',
        'AI agents can discover and use the facilitator as a native payment tool.',
        '',
        'Compatible with Claude, GPT-4o, and any MCP-compliant agent framework.',
      ].join('\n'),
      response: {
        200: { type: 'object' },
      },
    },
  }, async (request, reply) => {
    const baseUrl = `${request.protocol}://${request.hostname}`

    return reply.send({
      schema_version: '1.0',
      name: 'facilitatorx402',
      description: 'x402 payment facilitator — verify and settle crypto micro-payments',
      version: '1.1.0',
      tools: [
        {
          name: 'verify_payment',
          description: 'Verify an x402 payment proof from a buyer. Call this before granting access to a paid resource.',
          input_schema: {
            type: 'object',
            required: ['x402Version', 'scheme', 'network', 'payload', 'requiredAmount', 'payTo', 'asset', 'expiresAt'],
            properties: {
              x402Version: { type: 'integer', description: 'x402 protocol version (use 1)', example: 1 },
              scheme: { type: 'string', description: 'Payment scheme', example: 'exact' },
              network: { type: 'string', description: 'Blockchain network identifier', example: 'base-mainnet' },
              payload: { type: 'object', description: 'Signed payment authorization payload' },
              requiredAmount: { type: 'string', description: 'Required amount in smallest unit', example: '1000000' },
              payTo: { type: 'string', description: 'Recipient wallet address' },
              asset: { type: 'string', description: 'ERC-20 token contract address' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
          },
          endpoint: `${baseUrl}/verify`,
          method: 'POST',
        },
        {
          name: 'settle_payment',
          description: 'Settle a verified payment on-chain. Returns a tx hash and receipt ID once confirmed.',
          input_schema: {
            type: 'object',
            required: ['requestId'],
            properties: {
              requestId: { type: 'string', description: 'The requestId returned by verify_payment' },
            },
          },
          endpoint: `${baseUrl}/settle`,
          method: 'POST',
        },
        {
          name: 'get_receipt',
          description: 'Retrieve an audit receipt for a settled payment.',
          input_schema: {
            type: 'object',
            required: ['receiptId'],
            properties: {
              receiptId: { type: 'string', description: 'Receipt ID returned by settle_payment' },
            },
          },
          endpoint: `${baseUrl}/receipts/{receiptId}`,
          method: 'GET',
        },
        {
          name: 'check_supported',
          description: 'Check which networks, assets, and schemes are supported by this facilitator.',
          input_schema: { type: 'object', properties: {} },
          endpoint: `${baseUrl}/supported`,
          method: 'GET',
        },
      ],
      resources: [
        {
          name: 'openapi_spec',
          description: 'Full OpenAPI 3.1 specification',
          uri: `${baseUrl}/docs/json`,
        },
      ],
      auth: {
        type: 'bearer',
        description: 'API key from POST /sellers/register. Public endpoints (health, supported, verify, settle) do not require auth.',
      },
    })
  })
}
