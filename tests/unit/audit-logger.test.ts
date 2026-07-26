import { describe, it, expect, vi } from 'vitest'
import { writeAuditLog, getAuditTrail } from '../../src/infrastructure/audit-logger.js'
import pino from 'pino'

const logger = pino({ level: 'silent' })

describe('writeAuditLog', () => {
  it('persists an audit entry', async () => {
    const createFn = vi.fn(async () => ({ id: 'log-001' }))
    const prisma = { auditLog: { create: createFn } } as any

    await writeAuditLog(prisma, logger, {
      entityType: 'payment_request',
      entityId:   'req-001',
      action:     'verify.accepted',
      actor:      '0xSELLER',
      payload:    { verificationId: 'ver-001' },
    })

    expect(createFn).toHaveBeenCalledOnce()
    const arg = createFn.mock.calls[0]![0].data
    expect(arg.action).toBe('verify.accepted')
    expect(arg.entityId).toBe('req-001')
  })

  it('does not throw on DB failure (fire-and-forget)', async () => {
    const prisma = {
      auditLog: { create: vi.fn(async () => { throw new Error('DB error') }) },
    } as any

    await expect(
      writeAuditLog(prisma, logger, {
        entityType: 'payment_settlement',
        entityId:   'set-001',
        action:     'settle.confirmed',
        actor:      'system',
      })
    ).resolves.toBeUndefined()
  })
})

describe('getAuditTrail', () => {
  it('returns entries ordered by createdAt asc', async () => {
    const entries = [
      { id: '1', action: 'verify.accepted', createdAt: new Date('2026-01-01') },
      { id: '2', action: 'settle.confirmed', createdAt: new Date('2026-01-02') },
    ]
    const prisma = {
      auditLog: { findMany: vi.fn(async () => entries) },
    } as any

    const trail = await getAuditTrail(prisma, 'payment_request', 'req-001')
    expect(trail).toHaveLength(2)
    expect(trail[0].action).toBe('verify.accepted')
  })
})
