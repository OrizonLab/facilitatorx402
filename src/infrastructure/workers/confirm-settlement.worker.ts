import { Worker, Queue } from 'bullmq'
import { redis } from '../redis.js'
import { logger } from '../logger.js'
import { workerActiveJobs, workerQueueDepth } from '../metrics.js'

export const settlementQueue = new Queue('settlement-confirmations', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
})

export function startSettlementWorker(): Worker {
  const worker = new Worker(
    'settlement-confirmations',
    async (job) => {
      logger.info({ jobId: job.id, data: job.data }, 'Processing settlement confirmation job')
      // Jobs are enqueued for future async confirmation flows
      // In V1 synchronous mode, confirmation happens inline in settle usecase
    },
    { connection: redis, concurrency: 5 },
  )

  worker.on('active', () => workerActiveJobs.inc())
  worker.on('completed', () => workerActiveJobs.dec())
  worker.on('failed', (job, err) => {
    workerActiveJobs.dec()
    logger.error({ jobId: job?.id, err: err.message }, 'Settlement worker job failed')
  })

  setInterval(async () => {
    const counts = await settlementQueue.getJobCounts('wait', 'active')
    workerQueueDepth.set(counts.wait ?? 0)
  }, 5000)

  logger.info('Settlement worker started')
  return worker
}
