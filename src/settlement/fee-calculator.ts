/**
 * REMOVED — superseded by fee-engine.ts
 *
 * This file was the V1 draft of the fee calculator.
 * It is superseded by src/settlement/fee-engine.ts (FeeEngine class) which adds:
 *   - Free tier support (freeTierMonthlyUnits)
 *   - Premium tier overrides per seller with expiration
 *   - format() for serializable output
 *   - Full unit test coverage
 *
 * Note: settle-payment.ts currently imports from this file.
 * TODO (v1.1): update settle-payment.ts to use FeeEngine.compute() instead.
 *
 * @deprecated Use src/settlement/fee-engine.ts → FeeEngine
 */

export {} // keep module boundary — file is intentionally empty pending deletion via git
