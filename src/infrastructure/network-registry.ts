import { logger } from './logger.js'

export interface NetworkConfig {
  chainId: number
  name: string
  rpcUrl: string
  fallbackRpcUrl?: string
  nativeCurrency: string
  blockExplorer: string
  active: boolean
  addedAt: string
}

export interface AssetConfig {
  chainId: number
  symbol: string
  address: string
  decimals: number
  minAmount: string
  maxAmount: string
  active: boolean
}

/**
 * NetworkRegistry — dynamic multi-network/multi-asset configuration.
 *
 * Networks and assets are stored in the DB and loaded at startup.
 * The admin API (PUT /admin/networks/:chainId) updates the DB;
 * the registry reloads every 60s without restart.
 *
 * This is the core abstraction enabling expansion to:
 * - New EVM chains (Ethereum, Polygon, Arbitrum, Optimism...)
 * - New assets (USDC, USDT, DAI, native ETH...)
 * - Future non-EVM chains (Solana, Cosmos) via adapter pattern
 */
export class NetworkRegistry {
  private networks: Map<string, NetworkConfig> = new Map()
  private assets: Map<string, AssetConfig[]> = new Map()
  private refreshIntervalMs: number
  private refreshTimer?: ReturnType<typeof setInterval>

  constructor(refreshIntervalMs = 60_000) {
    this.refreshIntervalMs = refreshIntervalMs
  }

  async load(networks: NetworkConfig[], assets: AssetConfig[]): Promise<void> {
    for (const network of networks) {
      if (network.active) {
        this.networks.set(network.name, network)
        logger.info({ network: network.name, chainId: network.chainId }, 'network loaded')
      }
    }
    for (const asset of assets) {
      if (asset.active) {
        const key = String(asset.chainId)
        if (!this.assets.has(key)) this.assets.set(key, [])
        this.assets.get(key)!.push(asset)
      }
    }
    logger.info(
      { networks: this.networks.size, assetEntries: assets.length },
      'network registry loaded'
    )
  }

  startAutoRefresh(loader: () => Promise<{ networks: NetworkConfig[]; assets: AssetConfig[] }>): void {
    this.refreshTimer = setInterval(async () => {
      try {
        const data = await loader()
        this.networks.clear()
        this.assets.clear()
        await this.load(data.networks, data.assets)
      } catch (err: unknown) {
        logger.error({ err }, 'network registry refresh failed')
      }
    }, this.refreshIntervalMs)
    logger.info({ intervalMs: this.refreshIntervalMs }, 'network registry auto-refresh started')
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
  }

  isNetworkSupported(name: string): boolean {
    return this.networks.has(name)
  }

  isAssetSupported(chainId: number, address: string): boolean {
    const chainAssets = this.assets.get(String(chainId)) ?? []
    return chainAssets.some((a) => a.address.toLowerCase() === address.toLowerCase())
  }

  getNetwork(name: string): NetworkConfig | undefined {
    return this.networks.get(name)
  }

  getSupportedNetworks(): NetworkConfig[] {
    return [...this.networks.values()]
  }

  getSupportedAssets(chainId?: number): AssetConfig[] {
    if (chainId !== undefined) {
      return this.assets.get(String(chainId)) ?? []
    }
    return [...this.assets.values()].flat()
  }

  toSupportedResponse() {
    const networks = this.getSupportedNetworks()
    const assets: Record<string, unknown> = {}
    for (const asset of this.getSupportedAssets()) {
      assets[asset.symbol] = {
        symbol: asset.symbol,
        decimals: asset.decimals,
        address: asset.address,
        chainId: asset.chainId,
        minAmount: asset.minAmount,
        maxAmount: asset.maxAmount,
      }
    }
    return {
      x402Versions: [1],
      networks: networks.map((n) => n.name),
      assets,
      schemes: ['exact'],
      extensions: ['receipts', 'webhooks', 'streaming', 'mcp'],
      settlement: { confirmations: 1, timeoutMs: 120_000 },
    }
  }
}

export const networkRegistry = new NetworkRegistry()
