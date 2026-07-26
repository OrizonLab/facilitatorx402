/**
 * @deprecated
 * This file is kept for backward compatibility only.
 * All anti-replay logic has been consolidated into src/protocol/anti-replay.ts
 * which is the canonical, race-condition-safe implementation.
 *
 * Do not add new code here. Import directly from:
 *   import { ... } from '../protocol/anti-replay.js'
 */
export * from '../protocol/anti-replay.js'
