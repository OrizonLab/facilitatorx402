/**
 * Prisma seed — PostgreSQL only.
 * Seeds the initial network and asset configuration for local development.
 *
 * Run: npm run db:seed
 */
import { PrismaClient } from '@prisma/client'
import { ulid } from 'ulid'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database (PostgreSQL)...')

  // Base mainnet
  const baseNetwork = await prisma.network.upsert({
    where: { name: 'base-mainnet' },
    update: {},
    create: {
      id: ulid(),
      chainId: 8453,
      name: 'base-mainnet',
      rpcUrl: process.env.RPC_URL ?? 'https://mainnet.base.org',
      fallbackRpcUrl: 'https://base.llamarpc.com',
      nativeCurrency: 'ETH',
      blockExplorer: 'https://basescan.org',
      active: true,
      addedBy: 'seed',
    },
  })

  // Base Sepolia (testnet)
  const baseTestnet = await prisma.network.upsert({
    where: { name: 'base-sepolia' },
    update: {},
    create: {
      id: ulid(),
      chainId: 84532,
      name: 'base-sepolia',
      rpcUrl: process.env.RPC_URL_TESTNET ?? 'https://sepolia.base.org',
      fallbackRpcUrl: 'https://base-sepolia.llamarpc.com',
      nativeCurrency: 'ETH',
      blockExplorer: 'https://sepolia.basescan.org',
      active: true,
      addedBy: 'seed',
    },
  })

  // USDC on Base mainnet
  await prisma.networkAsset.upsert({
    where: { networkId_symbol: { networkId: baseNetwork.id, symbol: 'USDC' } },
    update: {},
    create: {
      id: ulid(),
      networkId: baseNetwork.id,
      symbol: 'USDC',
      address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      decimals: 6,
      minAmount: '1',         // 0.000001 USDC — micro-payment for AI/robots
      maxAmount: '1000000000', // 1000 USDC
      active: true,
    },
  })

  // USDC on Base Sepolia
  await prisma.networkAsset.upsert({
    where: { networkId_symbol: { networkId: baseTestnet.id, symbol: 'USDC' } },
    update: {},
    create: {
      id: ulid(),
      networkId: baseTestnet.id,
      symbol: 'USDC',
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      decimals: 6,
      minAmount: '1',
      maxAmount: '1000000000',
      active: true,
    },
  })

  console.log('Seed complete.')
  console.log(`  Networks: base-mainnet (chainId 8453), base-sepolia (chainId 84532)`)
  console.log(`  Assets: USDC on both networks`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
