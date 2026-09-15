import { pgTable, uuid, varchar, timestamp, jsonb, text, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    channel: varchar('channel', { length: 50 }).notNull(),
    channelConversationId: varchar('channel_conversation_id', { length: 255 }),
    title: varchar('title', { length: 500 }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    agentId: varchar('agent_id', { length: 100 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_conversations_tenant').on(t.tenantId),
    index('idx_conversations_channel').on(t.channel, t.channelConversationId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .references(() => conversations.id)
      .notNull(),
    role: varchar('role', { length: 20 }).notNull(),
    content: text('content'),
    toolCalls: jsonb('tool_calls').$type<unknown[]>(),
    toolResults: jsonb('tool_results').$type<unknown[]>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_messages_conversation').on(t.conversationId, t.createdAt)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    conversationId: uuid('conversation_id')
      .references(() => conversations.id)
      .notNull(),
    agentId: varchar('agent_id', { length: 100 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    modelRefs: jsonb('model_refs').$type<string[]>().notNull().default([]),
    tokenUsage: text('token_usage').notNull().default('0'),
    contextWindow: jsonb('context_window').$type<unknown>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_sessions_conversation').on(t.conversationId)],
);