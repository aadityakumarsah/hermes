import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is required to run migrations');
}

const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool);

const folder = process.env.DRIZZLE_MIGRATIONS_FOLDER ?? new URL('../../drizzle', import.meta.url).pathname;
await migrate(db, { migrationsFolder: folder });
console.log('Migrations applied');
await pool.end();