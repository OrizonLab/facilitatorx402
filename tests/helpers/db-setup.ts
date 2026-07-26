import { PrismaClient } from '@prisma/client';

export const testPrisma = new PrismaClient({
  datasources: {
    db: { url: process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'] },
  },
});

/** Remet à zéro toutes les tables de test dans l'ordre correct (FK safe). */
export async function cleanDatabase(): Promise<void> {
  await testPrisma.$transaction([
    testPrisma.paymentReceipt.deleteMany(),
    testPrisma.paymentSettlement.deleteMany(),
    testPrisma.paymentVerification.deleteMany(),
    testPrisma.paymentRequest.deleteMany(),
    testPrisma.seller.deleteMany(),
  ]);
}

/** Crée un seller de test minimal avec une API key fixe. */
export async function seedTestSeller(overrides?: Partial<{
  id: string;
  name: string;
  walletAddress: string;
  referralCode: string;
}>) {
  return testPrisma.seller.create({
    data: {
      id: overrides?.id ?? 'seller-test-001',
      name: overrides?.name ?? 'Test Seller',
      walletAddress: overrides?.walletAddress ?? '0xTestSellerAddress000000000000000000000001',
      referralCode: overrides?.referralCode ?? null,
      apiKeyHash: 'test-api-key-hash',
      isActive: true,
    },
  });
}

export async function disconnectDb(): Promise<void> {
  await testPrisma.$disconnect();
}
