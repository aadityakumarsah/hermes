import { pgTable, uuid, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { memories } from './memories.js';

export const memoryEvents = pgTable(
  'memory_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memoryId: uuid('memory_id')
      .references(() => memories.id, { onDelete: 'cascade' })
      .notNull(),
    eventType: varchar('event_type', { length: 30 }).notNull(),
    actor: varchar('actor', { length: 20 }).notNull(),
    actorUserId: uuid('actor_user_id'),
    actorAgentId: varchar('actor_agent_id', { length: 100 }),
    reason: varchar('reason', { length: 500 }),
    changed: jsonb('changed').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_memory_events_memory').on(t.memoryId, t.occurredAt)],
);