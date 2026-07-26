// ─── @orizonlab/x402-client — public API ─────────────────────────────────────
// Stable exports — do not break without semver major bump

export { FacilitatorClient } from './client.js'
export {
  FacilitatorAPIError,
  FacilitatorNetworkError,
  FacilitatorTimeoutError,
} from './errors.js'
export type {
  FacilitatorClientOptions,
  X402PaymentProof,
  VerifyResponse,
  SettleResponse,
  Receipt,
  SupportedConfig,
  HealthStatus,
  FacilitatorError,
} from './types.js'
