import { pgTable, uuid, varchar, text, timestamp, jsonb, integer, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './tenants.js';

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    userId: uuid('user_id').references(() => users.id),
    type: varchar('type', { length: 100 }).notNull(),
    queueName: varchar('queue_name', { length: 100 }).notNull().default('default'),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb('result').$type<unknown>(),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_jobs_type_status').on(t.type, t.status)],
);