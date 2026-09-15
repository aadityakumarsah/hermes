import { pgTable, uuid, varchar, text, timestamp, jsonb, real, customType, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// Matches OpenAI text-embedding-3-small dimensions.
export const EMBEDDING_DIMENSIONS = 1536;

const vector = customType<{ data: number[]; driverData: number[] }>({
  dataType() {
    return `vector(${EMBEDDING_DIMENSIONS})`;
  },
  toDriver(value): number[] {
    return value;
  },
  fromDriver(value): number[] {
    return value;
  },
});

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    userId: uuid('user_id'),
    conversationId: uuid('conversation_id'),
    type: varchar('type', { length: 20 }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    importance: real('importance').notNull().default(0.5),
    source: varchar('source', { length: 50 }).notNull().default('conversation'),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [index('idx_memories_tenant').on(t.tenantId), index('idx_memories_embedding').using('ivfflat', t.embedding.op('vector_cosine_ops'))],
);