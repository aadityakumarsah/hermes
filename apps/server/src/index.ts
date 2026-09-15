import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { createLogger } from '@hermes/observability';
import { loadConfig, missingRequiredEnvVars } from '@hermes/config';
import { createDatabaseClient, createRedisBus } from '@hermes/storage';
import { startServer, type BootResult } from './server.js';
import { HERMES_VERSION } from '@hermes/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main(): Promise<void> {
  const missing = missingRequiredEnvVars();
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  const logger = createLogger();
  const config = loadConfig();
  logger.info('starting hermes server', { version: HERMES_VERSION, env: config.env });

  const db = createDatabaseClient(config.database, logger);
  const redisBus = createRedisBus(config.redis, logger);

  const result = await startServer({ config, logger, db, redisBus });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    await result.close().catch(() => {});
    await redisBus.close().catch(() => {});
    await db.close().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info(`hermes listening on http://${config.server.host}:${config.server.port}`);
  void result;
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});

export type { BootResult };