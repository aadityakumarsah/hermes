import { pgTable, uuid, varchar, text, timestamp, jsonb, real, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { agents } from './agents.js';

// Matches OpenAI text-embedding-3-small dimensions.
export const EMBEDDING_DIMENSIONS = 1536;

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    userId: uuid('user_id'),
    agentId: uuid('agent_id').references(() => agents.id),
    conversationId: uuid('conversation_id'),
    sessionId: uuid('session_id'),
    type: varchar('type', { length: 20 }).notNull(),
    memoryKey: varchar('memory_key', { length: 255 }),
    content: text('content').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    importance: real('importance').notNull().default(0.5),
    confidence: real('confidence').notNull().default(0.8),
    explicit: boolean('explicit').notNull().default(true),
    source: varchar('source', { length: 50 }).notNull().default('conversation'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_memories_tenant').on(t.tenantId),
    index('idx_memories_user').on(t.userId, t.type),
    uniqueIndex('uq_memories_hash').on(t.tenantId, t.userId, t.type, t.contentHash),
    index('idx_memories_key').on(t.tenantId, t.userId, t.memoryKey),
  ],
);