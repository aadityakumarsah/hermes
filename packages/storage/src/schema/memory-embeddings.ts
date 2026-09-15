import { pgTable, uuid, varchar, timestamp, integer, customType, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { memories, EMBEDDING_DIMENSIONS } from './memories.js';

export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIMENSIONS})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    const inner = value.replace(/^\[/, '').replace(/\]$/, '');
    return inner.split(',').map(Number);
  },
});

export const memoryEmbeddings = pgTable(
  'memory_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memoryId: uuid('memory_id')
      .references(() => memories.id, { onDelete: 'cascade' })
      .notNull(),
    embedding: vector('embedding').notNull(),
    model: varchar('model', { length: 100 }).notNull(),
    dimensions: integer('dimensions').notNull().default(EMBEDDING_DIMENSIONS),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_memory_embeddings_vector').using('ivfflat', t.embedding.op('vector_cosine_ops')),
    uniqueIndex('uq_memory_embeddings_model').on(t.memoryId, t.model),
  ],
);