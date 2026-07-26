import { vi } from 'vitest';

/** Mock complet du RPC client viem pour les tests unitaires. */
export function createMockRpcClient() {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(BigInt(19_000_000)),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      transactionHash: '0xdeadbeef00000000000000000000000000000000000000000000000000000001',
      blockNumber: BigInt(19_000_001),
      status: 'success',
      gasUsed: BigInt(21_000),
      effectiveGasPrice: BigInt(1_000_000_000),
    }),
    sendRawTransaction: vi.fn().mockResolvedValue(
      '0xdeadbeef00000000000000000000000000000000000000000000000000000001'
    ),
    estimateGas: vi.fn().mockResolvedValue(BigInt(21_000)),
    getBalance: vi.fn().mockResolvedValue(BigInt(1e18)),
    readContract: vi.fn().mockResolvedValue(BigInt(1e6)),
    writeContract: vi.fn().mockResolvedValue(
      '0xdeadbeef00000000000000000000000000000000000000000000000000000002'
    ),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      transactionHash: '0xdeadbeef00000000000000000000000000000000000000000000000000000001',
      blockNumber: BigInt(19_000_001),
      status: 'success',
    }),
  };
}

export type MockRpcClient = ReturnType<typeof createMockRpcClient>;

/** Mock d'une tx échouée (revert on-chain). */
export function createFailingRpcClient() {
  const mock = createMockRpcClient();
  mock.waitForTransactionReceipt.mockResolvedValue({
    transactionHash: '0xfailed000000000000000000000000000000000000000000000000000000001',
    blockNumber: BigInt(19_000_001),
    status: 'reverted',
  });
  return mock;
}
