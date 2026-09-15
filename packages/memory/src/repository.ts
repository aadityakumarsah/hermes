import { and, desc, eq, gte, inArray, isNull, not, sql, type SQL } from 'drizzle-orm';
import type { ConversationId, MemoryId, MemorySource, MemoryStatus, MemoryType, SessionId, TenantId, UserId } from '@hermes/core';
import { memoryEmbeddings, memoryEvents, memories, type HermesDatabase } from '@hermes/storage';
import type { MemoryListEntry, MemoryRecord, MemoryRetrievalQuery } from './types.js';

export interface SemanticHit {
  record: MemoryRecord;
  similarity: number;
}

export interface InsertRecordInput {
  id?: MemoryId;
  tenantId: TenantId;
  userId?: UserId | null;
  agentId?: string | null;
  conversationId?: ConversationId | null;
  sessionId?: string | null;
  type: MemoryType;
  memoryKey?: string | null;
  content: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
  importance?: number;
  confidence?: number;
  explicit?: boolean;
  source?: MemorySource;
  status?: MemoryStatus;
  createdAt?: Date;
  updatedAt?: Date;
  lastAccessedAt?: Date;
  expiresAt?: Date | null;
}

export type MemoryRow = typeof memories.$inferSelect;

export interface EventLogInput {
  memoryId: MemoryId;
  eventType: string;
  actor: 'user' | 'agent' | 'system' | 'api';
  actorUserId?: UserId | null;
  reason?: string;
  changed?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface PatchMemoryInput {
  content?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
  importance?: number;
  confidence?: number;
  explicit?: boolean;
  status?: MemoryStatus;
  memoryKey?: string | null;
  expiresAt?: Date | null;
  lastAccessedAt?: Date;
  updatedAt?: Date;
}

export class MemoryRepository {
  constructor(private readonly db: HermesDatabase) {}

  async insert(input: InsertRecordInput): Promise<MemoryRecord> {
    const now = input.updatedAt ?? new Date();
    const record = {
      id: input.id ?? ('' as MemoryId),
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      agentId: input.agentId ?? null,
      conversationId: input.conversationId ?? null,
      sessionId: input.sessionId ?? null,
      type: input.type,
      memoryKey: input.memoryKey ?? null,
      content: input.content,
      contentHash: input.contentHash,
      metadata: input.metadata ?? {},
      importance: round(input.importance ?? 0.5),
      confidence: round(input.confidence ?? 0.8),
      explicit: input.explicit ?? true,
      source: input.source ?? 'conversation',
      status: input.status ?? 'active',
      accessCount: 0,
      lastAccessedAt: input.lastAccessedAt ?? now,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
      expiresAt: input.expiresAt ?? null,
    };

    const rows = await this.db
      .insert(memories)
      .values({
        tenantId: record.tenantId,
        userId: record.userId,
        agentId: record.agentId,
        conversationId: record.conversationId,
        sessionId: record.sessionId,
        type: record.type,
        memoryKey: record.memoryKey,
        content: record.content,
        contentHash: record.contentHash,
        metadata: record.metadata,
        importance: record.importance,
        confidence: record.confidence,
        explicit: record.explicit,
        source: record.source,
        status: record.status,
        lastAccessedAt: record.lastAccessedAt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        expiresAt: record.expiresAt,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error('insertMemory: no row returned');
    }
    return mapMemoryRow(row);
  }

  async insertEmbedding(input: {
    memoryId: MemoryId;
    embedding: number[];
    model: string;
    dimensions: number;
  }): Promise<void> {
    await this.db
      .insert(memoryEmbeddings)
      .values({
        memoryId: input.memoryId,
        embedding: input.embedding,
        model: input.model,
        dimensions: input.dimensions,
      })
      .onConflictDoNothing();
  }

  async getById(memoryId: MemoryId, tenantId: TenantId): Promise<MemoryRecord | null> {
    const rows = await this.db
      .select()
      .from(memories)
      .where(and(eq(memories.id, memoryId), eq(memories.tenantId, tenantId)));
    const row = rows[0];
    return row ? mapMemoryRow(row) : null;
  }

  async findByHash(
    tenantId: TenantId,
    userId: UserId | null,
    type: MemoryType,
    hash: string,
  ): Promise<MemoryRecord | null> {
    const rows = await this.db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.tenantId, tenantId),
          eq(memories.type, type),
          eq(memories.contentHash, hash),
          userId ? eq(memories.userId, userId) : isNull(memories.userId),
        ),
      );
    const row = rows[0];
    return row ? mapMemoryRow(row) : null;
  }

  async findByMemoryKey(
    tenantId: TenantId,
    userId: UserId | null,
    type: MemoryType,
    memoryKey: string,
  ): Promise<MemoryRecord | null> {
    const rows = await this.db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.tenantId, tenantId),
          eq(memories.type, type),
          eq(memories.memoryKey, memoryKey),
          not(eq(memories.status, 'deleted')),
          userId ? eq(memories.userId, userId) : isNull(memories.userId),
        ),
      );
    const row = rows[0];
    return row ? mapMemoryRow(row) : null;
  }

  async patch(memoryId: MemoryId, tenantId: TenantId, patch: PatchMemoryInput): Promise<MemoryRecord | null> {
    const current = await this.getById(memoryId, tenantId);
    if (!current) {
      return null;
    }
    const rows = await this.db
      .update(memories)
      .set({
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.contentHash !== undefined ? { contentHash: patch.contentHash } : {}),
        ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
        ...(patch.importance !== undefined ? { importance: round(patch.importance) } : {}),
        ...(patch.confidence !== undefined ? { confidence: round(patch.confidence) } : {}),
        ...(patch.explicit !== undefined ? { explicit: patch.explicit } : {}),
        ...(patch.memoryKey !== undefined ? { memoryKey: patch.memoryKey } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
        ...(patch.lastAccessedAt !== undefined ? { lastAccessedAt: patch.lastAccessedAt } : {}),
        ...{ updatedAt: patch.updatedAt ?? new Date() },
      })
      .where(and(eq(memories.id, memoryId), eq(memories.tenantId, tenantId)))
      .returning();
    const row = rows[0];
    return row ? mapMemoryRow(row) : current;
  }

  async touch(memoryId: MemoryId, tenantId: TenantId, at?: Date): Promise<void> {
    await this.db
      .update(memories)
      .set({ accessCount: sql`${memories.accessCount} + 1`, lastAccessedAt: at ?? new Date() })
      .where(and(eq(memories.id, memoryId), eq(memories.tenantId, tenantId)));
  }

  async hardDelete(memoryId: MemoryId, tenantId: TenantId): Promise<boolean> {
    const deleted = await this.db
      .delete(memories)
      .where(and(eq(memories.id, memoryId), eq(memories.tenantId, tenantId)));
    return (deleted.rowCount ?? 0) > 0;
  }

  async deleteByOwnership(
    tenantId: TenantId,
    userId: UserId | null,
  ): Promise<number> {
    const deleted = await this.db
      .delete(memories)
      .where(
        and(
          eq(memories.tenantId, tenantId),
          userId ? eq(memories.userId, userId) : isNull(memories.userId),
        ),
      );
    return deleted.rowCount ?? 0;
  }

  /**
   * Cosine similarity search over the memory_embeddings table, joined back to
   * the owning memory row. Distance `<=>` is pgvector's cosine operator.
   */
  async semanticSearch(params: {
    tenantId: TenantId;
    vector: number[];
    types?: MemoryType[];
    userId?: UserId | null;
    agentId?: string | null;
    minImportance?: number;
    metadata?: Record<string, unknown>;
    limit: number;
  }): Promise<SemanticHit[]> {
    if (params.vector.length === 0) {
      return [];
    }
    const vecText = `[${params.vector.join(',')}]`;
    const distance = sql`${memoryEmbeddings.embedding} <=> (${vecText})::vector`;
    const similarity = sql<number>`1 - (${memoryEmbeddings.embedding} <=> (${vecText})::vector)`;

    const conditions: SQL[] = [
      eq(memories.tenantId, params.tenantId),
      eq(memories.status, 'active'),
    ];
    if (params.types?.length) {
      conditions.push(inArray(memories.type, params.types));
    }
    if (params.userId) {
      conditions.push(eq(memories.userId, params.userId));
    }
    if (params.agentId) {
      conditions.push(eq(memories.agentId, params.agentId));
    }
    if (params.minImportance !== undefined && params.minImportance !== null) {
      conditions.push(gte(memories.importance, params.minImportance));
    }
    conditions.push(...metadataConditions(params.metadata));

    const rows = await this.db
      .select({ memory: memories, similarity })
      .from(memories)
      .innerJoin(memoryEmbeddings, eq(memoryEmbeddings.memoryId, memories.id))
      .where(and(...conditions))
      .orderBy(distance)
      .limit(params.limit);

    return rows.map((row) => ({
      record: mapMemoryRow(row.memory),
      similarity: typeof row.similarity === 'number' ? row.similarity : 0,
    }));
  }

  async list(query: MemoryRetrievalQuery, touchOnList = false): Promise<MemoryListEntry[]> {
    const conditions: SQL[] = [eq(memories.tenantId, query.tenantId)];
    if (query.userId) {
      conditions.push(eq(memories.userId, query.userId));
    }
    if (query.agentId) {
      conditions.push(eq(memories.agentId, query.agentId));
    }
    if (query.source) {
      conditions.push(eq(memories.source, query.source));
    }
    const types = memoryTypesOf(query);
    if (types.length) {
      conditions.push(inArray(memories.type, types));
    }
    const statuses = normalizedStatuses(query);
    if (statuses.length) {
      conditions.push(inArray(memories.status, statuses));
    } else {
      conditions.push(not(eq(memories.status, 'deleted')));
    }
    if (query.memoryKey) {
      conditions.push(eq(memories.memoryKey, query.memoryKey));
    }
    if (query.minImportance !== undefined && query.minImportance !== null) {
      conditions.push(gte(memories.importance, query.minImportance));
    }
    conditions.push(...metadataConditions(query.metadata));

    const limit = Math.min(query.limit ?? 50, 100);
    const offset = query.offset ?? 0;

    const rows = await this.db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.importance), desc(memories.updatedAt))
      .limit(limit)
      .offset(offset);

    if (touchOnList) {
      const ids = rows.map((row) => row.id);
      if (ids.length > 0) {
        await this.db
          .update(memories)
          .set({ accessCount: sql`${memories.accessCount} + 1`, lastAccessedAt: new Date() })
          .where(inArray(memories.id, ids));
      }
    }

    return rows.map((row) => ({ memory: mapMemoryRow(row) }));
  }

  async countByType(tenantId: TenantId, userId?: UserId | null): Promise<Record<MemoryType, number>> {
    const rows = await this.db
      .select({ type: memories.type, count: sql<number>`count(*)` })
      .from(memories)
      .where(and(eq(memories.tenantId, tenantId), userId ? eq(memories.userId, userId) : undefined))
      .groupBy(memories.type);
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.type] = Number(row.count);
    }
    return counts as Record<MemoryType, number>;
  }

  async logEvent(input: EventLogInput): Promise<void> {
    await this.db.insert(memoryEvents).values({
      memoryId: input.memoryId,
      eventType: input.eventType,
      actor: input.actor,
      actorUserId: input.actorUserId ?? null,
      reason: input.reason ?? null,
      changed: input.changed ?? {},
      occurredAt: input.occurredAt ?? new Date(),
    });
  }

  async eventsForMemory(memoryId: MemoryId, limit = 20): Promise<MemoryEventView[]> {
    const rows = await this.db
      .select()
      .from(memoryEvents)
      .where(eq(memoryEvents.memoryId, memoryId))
      .orderBy(desc(memoryEvents.occurredAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      memoryId: row.memoryId as MemoryId,
      eventType: row.eventType,
      actor: row.actor as 'user' | 'agent' | 'system' | 'api',
      actorUserId: row.actorUserId as UserId | null,
      actorAgentId: row.actorAgentId,
      reason: row.reason,
      changed: row.changed,
      occurredAt: row.occurredAt,
    }));
  }
}

export interface MemoryEventView {
  id: string;
  memoryId: MemoryId;
  eventType: string;
  actor: 'user' | 'agent' | 'system' | 'api';
  actorUserId: UserId | null;
  actorAgentId: string | null;
  reason: string | null;
  changed: Record<string, unknown>;
  occurredAt: Date;
}

function memoryTypesOf(query: MemoryRetrievalQuery): MemoryType[] {
  const set = new Set<MemoryType>();
  if (query.type) {
    set.add(query.type);
  }
  for (const type of query.types ?? []) {
    set.add(type);
  }
  return [...set];
}

function normalizedStatuses(query: MemoryRetrievalQuery): MemoryStatus[] {
  const raw = query.status;
  if (raw === undefined) {
    return [];
  }
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((s): s is MemoryStatus => s === 'active' || s === 'archived' || s === 'deleted');
}

function metadataConditions(metadata?: Record<string, unknown>): SQL[] {
  const conditions: SQL[] = [];
  if (!metadata) {
    return conditions;
  }
  for (const [key, value] of Object.entries(metadata)) {
    conditions.push(sql`${memories.metadata}->>${key} = ${String(value)}`);
  }
  return conditions;
}

export function mapMemoryRow(row: MemoryRow): MemoryRecord {
  return {
    id: row.id as MemoryId,
    tenantId: row.tenantId as TenantId,
    userId: (row.userId ?? null) as UserId | null,
    agentId: row.agentId,
    conversationId: (row.conversationId ?? null) as ConversationId | null,
    sessionId: row.sessionId as SessionId | null,
    type: row.type as MemoryType,
    memoryKey: row.memoryKey,
    content: row.content,
    contentHash: row.contentHash,
    metadata: row.metadata,
    importance: row.importance,
    confidence: row.confidence,
    explicit: row.explicit,
    source: row.source as MemorySource,
    status: row.status as MemoryStatus,
    accessCount: row.accessCount,
    lastAccessedAt: row.lastAccessedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}