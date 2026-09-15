import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is required to run migrations');
}

const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool);

const migrationsFolder = process.env.DRIZZLE_MIGRATIONS_FOLDER ?? path.resolve(fileURLToPath(new URL('../..', import.meta.url)), 'drizzle');
await migrate(db, { migrationsFolder });
console.log('Migrations applied');
await pool.end();