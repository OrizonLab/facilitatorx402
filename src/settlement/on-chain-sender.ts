/**
 * REMOVED — dead code.
 *
 * This file was a prototype of the ERC-3009 sender with manually split
 * v/r/s signature and an incorrect ABI (field named 'w' instead of 'r').
 *
 * The canonical implementation is src/settlement/on-chain.ts which:
 *   - Uses transferWithAuthorization (ERC-3009) — not ERC-20 transfer
 *   - Integrates with NetworkRegistry for multi-RPC failover
 *   - Uses getConfig() for typed env access
 *   - Has correct ABI field names
 *
 * @deprecated Use src/settlement/on-chain.ts → submitOnChain()
 */

export {} // keep module boundary — file is intentionally empty pending deletion via git
