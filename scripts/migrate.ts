#!/usr/bin/env tsx
/**
 * Script de migration Prisma pour CI/CD et démarrage Docker.
 * Usage : npx tsx scripts/migrate.ts [--deploy]
 */
import { execSync } from 'node:child_process';
import { logger } from '../src/infrastructure/logger.js';

const isDeploy = process.argv.includes('--deploy');
const command = isDeploy
  ? 'npx prisma migrate deploy'
  : 'npx prisma migrate dev --skip-seed';

logger.info({ command, isDeploy }, 'Running Prisma migration');

try {
  execSync(command, { stdio: 'inherit', env: process.env });
  logger.info('Migration completed successfully');
  process.exit(0);
} catch (error) {
  logger.error({ error }, 'Migration failed');
  process.exit(1);
}
