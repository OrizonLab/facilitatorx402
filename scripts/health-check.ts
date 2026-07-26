#!/usr/bin/env tsx
/**
 * Script de healthcheck pour Docker HEALTHCHECK instruction.
 * Retourne exit 0 si healthy, exit 1 sinon.
 */
import { getConfig } from '../src/infrastructure/config.js';

const config = getConfig();
const url = `http://localhost:${config.PORT ?? 3000}/health`;

async function check(): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) {
    console.error(`Health check failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const body = await res.json() as { status: string };
  if (body.status === 'down') {
    console.error('Health check status: down');
    process.exit(1);
  }
  console.log(`Health check OK: ${body.status}`);
  process.exit(0);
}

check().catch((err: unknown) => {
  console.error('Health check error:', err);
  process.exit(1);
});
