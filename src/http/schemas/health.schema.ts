import { z } from 'zod';

export const HealthComponentSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  latencyMs: z.number().optional(),
  detail: z.string().optional(),
});

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  uptime: z.number(),
  timestamp: z.string().datetime(),
  components: z.object({
    database: HealthComponentSchema,
    redis: HealthComponentSchema,
    worker: HealthComponentSchema,
    rpc: HealthComponentSchema,
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type HealthComponent = z.infer<typeof HealthComponentSchema>;
