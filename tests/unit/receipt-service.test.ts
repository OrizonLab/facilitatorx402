import { describe, it, expect, vi } from 'vitest'
import { getReceiptById } from '../../src/infrastructure/receipt-service.js'
import pino from 'pino'

const logger = pino({ level: 'silent' })

const MOCK_RECEIPT = {
  id: 'rec-001',
  requestId: 'req-001',
  settlementId: 'set-001',
  protocolVersion: '1',
  createdAt: new Date('2026-01-01T00:01:00Z'),
  responsePayload: {
    network: 'base-mainnet',
    asset: 'USDC',
    seller: '0xSELLER',
    buyer: '0xBUYER',
    amount: '1000000',
    txHash: '0x' + 'a'.repeat(64),
    feeAmount: '5000',
    developerShare: '1000',
    confirmedAt: '2026-01-01T00:01:00Z',
  },
  request:    { network: 'base-mainnet' },
  settlement: { referralCode: 'REF123' },
}

describe('getReceiptById', () => {
  it('returns a well-formed ReceiptDTO', async () => {
    const prisma = {
      paymentReceipt: {
        findUnique: vi.fn(async () => MOCK_RECEIPT),
      },
      auditLog: {
        create: vi.fn(async () => ({})),
      },
    } as any

    const receipt = await getReceiptById('rec-001', prisma, logger)
    expect(receipt.receiptId).toBe('rec-001')
    expect(receipt.txHash).toBe('0x' + 'a'.repeat(64))
    expect(receipt.feeAmount).toBe('5000')
    expect(receipt.developerShare).toBe('1000')
    expect(receipt.referralCode).toBe('REF123')
    expect(receipt.amount).toBe('1000000')
  })

  it('throws not_found when receipt does not exist', async () => {
    const prisma = {
      paymentReceipt: { findUnique: vi.fn(async () => null) },
      auditLog: { create: vi.fn() },
    } as any

    await expect(getReceiptById('nonexistent', prisma, logger)).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('audit log failure does not throw', async () => {
    const prisma = {
      paymentReceipt: { findUnique: vi.fn(async () => MOCK_RECEIPT) },
      auditLog: { create: vi.fn(async () => { throw new Error('DB down') }) },
    } as any

    // Must not throw despite audit failure
    await expect(getReceiptById('rec-001', prisma, logger)).resolves.toBeDefined()
  })
})
