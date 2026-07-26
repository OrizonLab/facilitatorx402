/**
 * REMOVED — dead code.
 *
 * This file used ERC-20 transfer() instead of ERC-3009 transferWithAuthorization().
 * The x402 protocol requires transferWithAuthorization to validate the buyer's
 * EIP-712 signature. A plain ERC-20 transfer() does not consume that authorization
 * and would break the payment proof model entirely.
 *
 * Additionally this file used module-level mutable state for the circuit breaker
 * (_rpcFailing, _circuitOpen) which is not safe in a multi-instance deployment.
 *
 * The canonical implementation is src/settlement/on-chain.ts.
 *
 * @deprecated Use src/settlement/on-chain.ts → submitOnChain()
 */

export {} // keep module boundary — file is intentionally empty pending deletion via git
