import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type Pool as PgPool } from 'pg';
import type { DatabaseConfig } from '@hermes/config';
import type { Logger } from '@hermes/core';
import * as schema from '../schema/index.js';

export type HermesDatabase = NodePgDatabase<typeof schema>;

export interface DatabaseClient {
  db: HermesDatabase;
  pool: PgPool;
  close(): Promise<void>;
}

export function createDatabaseClient(config: DatabaseConfig, logger: Logger): DatabaseClient {
  const pool = new Pool({
    connectionString: config.url,
    max: config.maxConnections,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  });

  pool.on('error', (err) => {
    logger.error('unexpected error on idle PostgreSQL client', { error: err.message });
  });

  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

export async function checkDatabaseConnection(client: DatabaseClient, logger: Logger): Promise<void> {
  const start = Date.now();
  const result = await client.pool.query('SELECT 1 AS ok');
  if (result.rows[0]?.ok !== 1) {
    throw new Error('Database health check failed');
  }
  logger.debug('database connection ok', { latencyMs: Date.now() - start });
}