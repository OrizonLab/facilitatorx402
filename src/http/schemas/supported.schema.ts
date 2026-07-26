import { z } from 'zod';

export const AssetInfoSchema = z.object({
  symbol: z.string(),
  address: z.string(),
  decimals: z.number(),
  minAmount: z.string(),
  maxAmount: z.string().optional(),
});

export const NetworkInfoSchema = z.object({
  chainId: z.number(),
  name: z.string(),
  rpcUrl: z.string().optional(),
  assets: z.array(AssetInfoSchema),
});

export const SupportedResponseSchema = z.object({
  versions: z.array(z.string()),
  networks: z.array(NetworkInfoSchema),
  schemes: z.array(z.string()),
  extensions: z.array(z.string()),
  limits: z.object({
    maxAmountUsd: z.string().optional(),
    minAmountUsd: z.string().optional(),
    rateLimit: z.object({
      verifyPerMinute: z.number(),
      settlePerMinute: z.number(),
    }),
  }),
  settlement: z.object({
    modes: z.array(z.string()),
    confirmationsRequired: z.number(),
    estimatedSettleMs: z.number(),
  }),
});

export type SupportedResponse = z.infer<typeof SupportedResponseSchema>;
