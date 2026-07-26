/**
 * Network Registry V2 — multi-network, multi-asset, hot-reloadable.
 *
 * Supports multiple chains and assets simultaneously.
 * Configuration loaded from NETWORKS_CONFIG env var (JSON) or default hardcoded.
 *
 * Each network entry:
 *   chainId        — EVM chain ID
 *   name           — human-readable identifier
 *   rpcUrl         — primary RPC
 *   fallbackRpcUrl — optional fallback RPC
 *   assets         — list of ERC-20 assets supported on this network
 *
 * V2 additions vs V1:
 *   - Multiple networks simultaneously (Base + Optimism + Arbitrum)
 *   - EURC support alongside USDC
 *   - getAsset(chainId, symbol) helper
 *   - reload() for hot config reload without restart
 *   - eip712Version per asset (EIP-712 domain version used in signature verification)
 */
import { logger } from './logger.js'

export interface AssetConfig {
  symbol: string
  address: `0x${string}`
  decimals: number
  name: string
  /** EIP-712 domain version used in TransferWithAuthorization. Defaults to '2'. */
  eip712Version?: string
}

export interface NetworkConfig {
  chainId: number
  name: string
  rpcUrl: string
  fallbackRpcUrl?: string | null
  assets: AssetConfig[]
  enabled: boolean
}

// V2 default multi-network config
const DEFAULT_NETWORKS: NetworkConfig[] = [
  {
    chainId: 8453,
    name: 'base-mainnet',
    rpcUrl: process.env.RPC_URL_BASE ?? 'https://mainnet.base.org',
    fallbackRpcUrl: process.env.RPC_URL_BASE_FALLBACK ?? null,
    enabled: true,
    assets: [
      {
        symbol: 'USDC',
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6,
        name: 'USD Coin',
        eip712Version: '2',
      },
      {
        symbol: 'EURC',
        address: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
        decimals: 6,
        name: 'Euro Coin',
        eip712Version: '2',
      },
    ],
  },
  {
    chainId: 10,
    name: 'optimism-mainnet',
    rpcUrl: process.env.RPC_URL_OPTIMISM ?? 'https://mainnet.optimism.io',
    fallbackRpcUrl: process.env.RPC_URL_OPTIMISM_FALLBACK ?? null,
    enabled: process.env.ENABLE_OPTIMISM === 'true',
    assets: [
      {
        symbol: 'USDC',
        address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        decimals: 6,
        name: 'USD Coin',
        eip712Version: '2',
      },
      {
        symbol: 'EURC',
        address: '0x82a4928dC8a761FBE08B0Bfc7e41F6E2f7E5B8d1',
        decimals: 6,
        name: 'Euro Coin',
        eip712Version: '2',
      },
    ],
  },
  {
    chainId: 42161,
    name: 'arbitrum-one',
    rpcUrl: process.env.RPC_URL_ARBITRUM ?? 'https://arb1.arbitrum.io/rpc',
    fallbackRpcUrl: process.env.RPC_URL_ARBITRUM_FALLBACK ?? null,
    enabled: process.env.ENABLE_ARBITRUM === 'true',
    assets: [
      {
        symbol: 'USDC',
        address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        decimals: 6,
        name: 'USD Coin',
        eip712Version: '2',
      },
    ],
  },
]

class NetworkRegistry {
  private networks: Map<number, NetworkConfig> = new Map()

  constructor() {
    this.load(DEFAULT_NETWORKS)
  }

  private load(configs: NetworkConfig[]): void {
    this.networks.clear()
    for (const net of configs) {
      if (net.enabled) {
        this.networks.set(net.chainId, net)
      }
    }
    logger.info(
      { enabledNetworks: [...this.networks.values()].map((n) => n.name) },
      'network registry loaded'
    )
  }

  /** Hot reload from JSON config (e.g., after env update) */
  reload(configs?: NetworkConfig[]): void {
    const toLoad = configs ?? DEFAULT_NETWORKS
    this.load(toLoad)
  }

  getNetwork(chainId: number): NetworkConfig | undefined {
    return this.networks.get(chainId)
  }

  getNetworkByName(name: string): NetworkConfig | undefined {
    return [...this.networks.values()].find((n) => n.name === name)
  }

  getAsset(chainId: number, symbol: string): AssetConfig | undefined {
    return this.networks.get(chainId)?.assets.find(
      (a) => a.symbol.toUpperCase() === symbol.toUpperCase()
    )
  }

  getAllNetworks(): NetworkConfig[] {
    return [...this.networks.values()]
  }

  isSupported(chainId: number, symbol: string): boolean {
    return !!this.getAsset(chainId, symbol)
  }

  /** For GET /supported endpoint */
  toSupportedPayload() {
    return {
      x402Versions: ['1'],
      networks: this.getAllNetworks().map((n) => ({
        name: n.name,
        chainId: n.chainId,
        assets: n.assets.map((a) => a.symbol),
      })),
      schemes: ['exact'],
      extensions: [],
      settlementOptions: {
        feeModel: 'basis_points',
        feeBps: Number(process.env.PLATFORM_FEE_BPS ?? 50),
        referralCodeSupported: true,
      },
    }
  }
}

export const networkRegistry = new NetworkRegistry()

// Re-export types for convenience
export type { AssetConfig as SupportedAsset, NetworkConfig as SupportedNetwork }
