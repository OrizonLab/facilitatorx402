/**
 * NetworkRegistry — source of truth for supported networks & assets.
 *
 * Loads from PostgreSQL on startup, then auto-reloads every 60s.
 * Never hits the DB on hot paths (verify / settle).
 * Changes made via admin API (/admin/networks) take effect within 60s.
 *
 * PostgreSQL ONLY — no SQLite fallback.
 */
import type { Network, NetworkAsset } from '@prisma/client'
import { db } from './db.js'
import { logger } from './logger.js'

export interface SupportedNetwork {
  chainId: number
  name: string
  rpcUrl: string
  fallbackRpcUrl: string | null
  nativeCurrency: string
  blockExplorer: string
  assets: SupportedAsset[]
}

export interface SupportedAsset {
  symbol: string
  address: string
  decimals: number
  minAmount: string
  maxAmount: string
}

type NetworkWithAssets = Network & { assets: NetworkAsset[] }

const RELOAD_INTERVAL_MS = 60_000

class NetworkRegistry {
  private networks: Map<number, SupportedNetwork> = new Map()
  private lastLoadedAt: Date | null = null
  private reloadTimer: ReturnType<typeof setInterval> | null = null

  /** Load active networks + assets from PostgreSQL */
  async load(): Promise<void> {
    const rows: NetworkWithAssets[] = await db.network.findMany({
      where: { active: true },
      include: { assets: { where: { active: true } } },
      orderBy: { chainId: 'asc' },
    })

    const fresh = new Map<number, SupportedNetwork>()
    for (const row of rows) {
      fresh.set(row.chainId, {
        chainId: row.chainId,
        name: row.name,
        rpcUrl: row.rpcUrl,
        fallbackRpcUrl: row.fallbackRpcUrl,
        nativeCurrency: row.nativeCurrency,
        blockExplorer: row.blockExplorer,
        assets: row.assets.map((a) => ({
          symbol: a.symbol,
          address: a.address,
          decimals: a.decimals,
          minAmount: a.minAmount,
          maxAmount: a.maxAmount,
        })),
      })
    }

    this.networks = fresh
    this.lastLoadedAt = new Date()

    logger.info(
      { networkCount: fresh.size, networks: [...fresh.values()].map((n) => n.name) },
      'NetworkRegistry loaded from PostgreSQL'
    )
  }

  /** Start background reload every 60s */
  startAutoReload(): void {
    if (this.reloadTimer) return
    this.reloadTimer = setInterval(async () => {
      try {
        await this.load()
      } catch (err) {
        logger.error({ err }, 'NetworkRegistry auto-reload failed — keeping previous state')
      }
    }, RELOAD_INTERVAL_MS)
  }

  stopAutoReload(): void {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer)
      this.reloadTimer = null
    }
  }

  /** Check if a network (by chainId) is active */
  isNetworkSupported(chainId: number): boolean {
    return this.networks.has(chainId)
  }

  /** Check if an asset is supported on a given network */
  isAssetSupported(chainId: number, symbol: string): boolean {
    const network = this.networks.get(chainId)
    if (!network) return false
    return network.assets.some((a) => a.symbol === symbol.toUpperCase())
  }

  /** Get a specific network or undefined */
  getNetwork(chainId: number): SupportedNetwork | undefined {
    return this.networks.get(chainId)
  }

  /** Get all active networks */
  getAll(): SupportedNetwork[] {
    return [...this.networks.values()]
  }

  /** Get a specific asset on a network */
  getAsset(chainId: number, symbol: string): SupportedAsset | undefined {
    return this.networks
      .get(chainId)
      ?.assets.find((a) => a.symbol === symbol.toUpperCase())
  }

  get loadedAt(): Date | null {
    return this.lastLoadedAt
  }
}

// Singleton — used across verify, settle, supported, health
export const networkRegistry = new NetworkRegistry()
