import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import type { TenantId, UserId } from '@hermes/core';
import { schema } from '@hermes/storage';

const MIGRATIONS = path.resolve(fileURLToPath(new URL('../..', import.meta.url)), 'storage/drizzle');

export interface TestDbContext {
  pool: Pool;
  db: NodePgDatabase<typeof schema>;
  tenantId: TenantId;
  userId: UserId;
  agentId: string;
  close(): Promise<void>;
}

export async function setupTestDb(): Promise<TestDbContext> {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://hermes:hermes@localhost:5432/hermes_test';
  const pool = new Pool({ connectionString: url, max: 5 });
  const db = drizzle(pool, { schema });

  await migrate(db, { migrationsFolder: MIGRATIONS });

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: `hermes-test-${randomUUID().slice(0, 8)}` })
    .returning();
  if (!tenant) {
    throw new Error('test tenant insert failed');
  }

  const [user] = await db
    .insert(schema.users)
    .values({ tenantId: tenant.id, email: `user-${randomUUID().slice(0, 8)}@hermes.test` })
    .returning();
  if (!user) {
    throw new Error('test user insert failed');
  }

  const [agent] = await db
    .insert(schema.agents)
    .values({ tenantId: tenant.id, name: 'test-agent', kind: 'default' })
    .returning();
  const agentId = agent?.id ?? randomUUID();

  return {
    pool,
    db,
    tenantId: tenant.id as TenantId,
    userId: user.id as UserId,
    agentId,
    async close() {
      try {
        await db.delete(schema.memories).where(eq(schema.memories.tenantId, tenant.id));
        await db.delete(schema.users).where(eq(schema.users.tenantId, tenant.id));
        await db.delete(schema.agents).where(eq(schema.agents.tenantId, tenant.id));
        await db.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id));
      } finally {
        await pool.end();
      }
    },
  };
}