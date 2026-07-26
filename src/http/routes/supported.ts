import type { FastifyInstance } from 'fastify'
import { config } from '../../infrastructure/config.js'

export async function supportedRoute(app: FastifyInstance): Promise<void> {
  app.get('/supported', async (_request, reply) => {
    return reply.send({
      protocols: ['x402/v1'],
      networks: [
        {
          chainId: config.SUPPORTED_CHAIN_ID,
          name: 'Base',
          explorer: 'https://basescan.org',
        },
      ],
      assets: [
        {
          symbol: config.SUPPORTED_ASSET_SYMBOL,
          address: config.SUPPORTED_ASSET_ADDRESS,
          decimals: config.SUPPORTED_ASSET_DECIMALS,
          network: config.SUPPORTED_CHAIN_ID,
        },
      ],
      schemes: ['erc20-transfer'],
      extensions: [],
      limits: {
        // No hard limits in V1 beyond rate limiting
        rateLimit: {
          verify: config.RATE_LIMIT_VERIFY,
          settle: config.RATE_LIMIT_SETTLE,
        },
      },
      settlement: {
        confirmationsRequired: config.CONFIRMATIONS_REQUIRED,
        timeoutSeconds: config.SETTLEMENT_TIMEOUT_SECONDS,
      },
      fees: {
        platformFeeBps: config.PLATFORM_FEE_BPS,
        freeMonthlyVolume: config.FREE_MONTHLY_VOLUME.toString(),
        referralSupported: true,
        developerSharePercent: config.DEVELOPER_SHARE_PERCENT,
      },
    })
  })
}
