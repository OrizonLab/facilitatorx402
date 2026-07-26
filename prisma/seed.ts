/**
 * Prisma seed — PostgreSQL ONLY.
 * Seeds base-mainnet + USDC for development.
 * Run: npx prisma db seed
 */
import { PrismaClient } from '@prisma/client'
import { ulid } from 'ulid'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  console.log('Seeding facilitatorx402 (PostgreSQL)...')

  // Base Mainnet
  const baseMainnet = await prisma.network.upsert({
    where: { chainId: 8453 },
    update: {},
    create: {
      id: ulid(),
      chainId: 8453,
      name: 'base-mainnet',
      rpcUrl: 'https://mainnet.base.org',
      fallbackRpcUrl: 'https://base.drpc.org',
      nativeCurrency: 'ETH',
      blockExplorer: 'https://basescan.org',
      active: true,
      addedBy: 'seed',
    },
  })

  console.log('  ✓ Network: base-mainnet (chainId 8453)')

  // USDC on Base
  await prisma.networkAsset.upsert({
    where: { networkId_symbol: { networkId: baseMainnet.id, symbol: 'USDC' } },
    update: {},
    create: {
      id: ulid(),
      networkId: baseMainnet.id,
      symbol: 'USDC',
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      decimals: 6,
      minAmount: '1',       // 0.000001 USDC
      maxAmount: '1000000000000', // 1,000,000 USDC
      active: true,
    },
  })

  console.log('  ✓ Asset: USDC on base-mainnet')

  // Base Sepolia (testnet)
  const baseSepolia = await prisma.network.upsert({
    where: { chainId: 84532 },
    update: {},
    create: {
      id: ulid(),
      chainId: 84532,
      name: 'base-sepolia',
      rpcUrl: 'https://sepolia.base.org',
      nativeCurrency: 'ETH',
      blockExplorer: 'https://sepolia.basescan.org',
      active: false, // disabled by default — enable via admin API
      addedBy: 'seed',
    },
  })

  console.log('  ✓ Network: base-sepolia (disabled — enable via admin API)')

  await prisma.networkAsset.upsert({
    where: { networkId_symbol: { networkId: baseSepolia.id, symbol: 'USDC' } },
    update: {},
    create: {
      id: ulid(),
      networkId: baseSepolia.id,
      symbol: 'USDC',
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      decimals: 6,
      minAmount: '1',
      maxAmount: '1000000000000',
      active: false,
    },
  })

  console.log('  ✓ Asset: USDC on base-sepolia (disabled)')
  console.log('Seed complete.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
