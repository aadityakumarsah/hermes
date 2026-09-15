import type { Memory, MemoryEngine, MemoryQuery, MemoryType } from '@hermes/core';
import type { Logger } from '@hermes/core';
import type { HermesDatabase } from '@hermes/storage';
import { MemoryRepository } from './repository.js';
import { contentHash } from './dedup.js';
import { buildContext, type ContextBuildOptions } from './context-builder.js';
import type { EmbeddingProvider } from './embeddings/index.js';
import { MemoryExtractor, RuleBasedExtractor } from './extractor/index.js';
import { scoreMemoryRecord } from './scoring.js';
import { toCoreMemory } from './map.js';
import type {
  ContextBundle,
  MemoryListEntry,
  MemoryRecord,
  MemoryRetrievalQuery,
  MemoryWithScore,
  StoreMemoryInput,
  StoreResult,
  TurnContext,
} from './types.js';

const BATCH_SIZE = 16;

export interface IngestResult {
  turn: TurnContext;
  extracted: number;
  stored: StoreResult[];
  recallCount: number;
}

export interface MemoryManagerOptions {
  db: HermesDatabase;
  embeddings: EmbeddingProvider;
  extractor?: MemoryExtractor;
  logger?: Logger;
  now?: () => Date;
  embeddingBatchSize?: number;
}

export interface UpdateMemoryInput {
  content?: string;
  metadata?: Record<string, unknown>;
  importance?: number;
  confidence?: number;
  explicit?: boolean;
  status?: 'active' | 'archived' | 'deleted';
  memoryKey?: string | null;
  actor?: 'user' | 'agent' | 'system' | 'api';
  actorUserId?: string | null;
  reason?: string;
  now?: Date;
}

/**
 * Orchestrates the memory lifecycle:
 * ingest (extract -> dedupe -> store) and retrieve (embed query -> rank by
 * importance * relevance * recency -> construct prompt context).
 */
export class MemoryManager {
  private readonly repository: MemoryRepository;
  private readonly embeddings: EmbeddingProvider;
  private readonly extractor: MemoryExtractor;
  private readonly logger: Logger | undefined;
  private readonly now: () => Date;
  private readonly batchSize: number;

  constructor(options: MemoryManagerOptions) {
    this.repository = new MemoryRepository(options.db);
    this.embeddings = options.embeddings;
    this.extractor = options.extractor ?? new RuleBasedExtractor();
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.batchSize = options.embeddingBatchSize ?? BATCH_SIZE;
  }

  /**
   * Process one conversational turn: extract durable facts, store them with
   * dedup provenance, and return the stored results.
   */
  async ingest(turn: TurnContext): Promise<IngestResult> {
    const now = turn.now ?? this.now();

    const extracted = await this.extractor.extract(turn);
    const stored: StoreResult[] = [];

    // Conversation memory: a rolling, per-conversation summary row (type
    // 'conversation') that keeps the latest exchange addressable in recall.
    const exchange = this.conversationSummary(turn);
    if (exchange) {
      stored.push(
        await this.store({
          tenantId: turn.tenantId,
          userId: turn.userId,
          agentId: turn.agentId,
          conversationId: turn.conversationId,
          sessionId: turn.sessionId,
          type: 'conversation',
          memoryKey: turn.conversationId ? `conversation:${turn.conversationId}` : undefined,
          content: exchange,
          source: 'conversation',
          explicit: true,
          importance: 0.7,
          now,
        }),
      );
    }

    for (const fact of extracted) {
      stored.push(
        await this.store({
          tenantId: turn.tenantId,
          userId: turn.userId,
          agentId: turn.agentId,
          conversationId: turn.conversationId,
          sessionId: turn.sessionId,
          type: fact.type,
          memoryKey: fact.memoryKey,
          content: fact.content,
          metadata: fact.metadata,
          importance: fact.importance,
          confidence: fact.confidence,
          explicit: true,
          source: 'conversation',
          evidence: fact.evidence,
          now,
        }),
      );
    }

    return { turn, extracted: extracted.length, stored, recallCount: stored.length };
  }

  /** Persist one memory, deduplicating against existing rows (hash or key). */
  async store(input: StoreMemoryInput): Promise<StoreResult> {
    const now = input.now ?? this.now();
    const tenantId = input.tenantId;
    const userId = input.userId ?? null;

    // 1. Idempotency by logical memory key (working memory KV, identity, etc.).
    if (input.memoryKey) {
      const byKey = await this.repository.findByMemoryKey(tenantId, userId, input.type, input.memoryKey);
      if (byKey && byKey.status !== 'deleted') {
        const updated = await this.updateContentInPlace(byKey, input, now);
        return { memory: updated, deduplicated: byKey.contentHash === updated.contentHash, updated: true, created: false };
      }
    }

    // 2. Idempotency by content hash.
    const hash = contentHash({
      tenantId,
      userId,
      type: input.type,
      content: input.content,
      memoryKey: input.memoryKey,
    });
    const byHash = await this.repository.findByHash(tenantId, userId, input.type, hash);
    if (byHash && byHash.status === 'deleted') {
      const revived = await this.repository.patch(byHash.id, tenantId, {
        status: 'active',
        content: input.content,
        contentHash: hash,
        metadata: input.metadata ?? byHash.metadata,
        importance: Math.max(byHash.importance, input.importance ?? byHash.importance),
        confidence: Math.max(byHash.confidence, input.confidence ?? byHash.confidence),
        explicit: input.explicit ?? byHash.explicit,
        updatedAt: now,
      });
      await this.repository.logEvent({
        memoryId: byHash.id,
        eventType: 'created',
        actor: 'agent',
        actorUserId: userId,
        reason: 'revived from deleted for re-statement',
        occurredAt: now,
      });
      return { memory: revived ?? byHash, deduplicated: true, updated: true, created: false };
    }
    if (byHash) {
      // Already known. Do not overwrite the first-learned version; boost its
      // importance so it ranks higher the more the user repeats it.
      if (input.importance !== undefined && input.importance > byHash.importance) {
        await this.repository.patch(byHash.id, tenantId, {
          importance: input.importance,
          confidence: Math.max(byHash.confidence, input.confidence ?? byHash.confidence),
          updatedAt: now,
        });
      }
      const refreshed = (await this.repository.getById(byHash.id, tenantId)) ?? byHash;
      await this.repository.logEvent({
        memoryId: byHash.id,
        eventType: 'deduplicated',
        actor: 'agent',
        actorUserId: userId,
        reason: 'same fact already stored; skipped re-insert',
        occurredAt: now,
      });
      return { memory: refreshed, deduplicated: true, updated: false, created: false };
    }

    // 3. New memory: insert row + embedding.
    const record = await this.repository.insert({
      tenantId,
      userId,
      agentId: input.agentId ?? null,
      conversationId: input.conversationId ?? null,
      sessionId: input.sessionId ?? null,
      type: input.type,
      memoryKey: input.memoryKey ?? null,
      content: input.content,
      contentHash: hash,
      metadata: { ...(input.metadata ?? {}), ...(input.evidence ? { _evidence: input.evidence } : {}) },
      importance: input.importance ?? 0.5,
      confidence: input.confidence ?? 0.8,
      explicit: input.explicit ?? true,
      source: input.source ?? 'conversation',
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      expiresAt: input.expiresAt ?? null,
    });

    await this.embedAndStore(record);
    await this.repository.logEvent({
      memoryId: record.id,
      eventType: 'created',
      actor: 'agent',
      actorUserId: userId,
      reason: input.source ?? 'conversation',
      changed: { type: input.type, importance: record.importance },
      occurredAt: now,
    });

    return { memory: record, deduplicated: false, updated: false, created: true };
  }

  /**
   * Semantic + ranked retrieval. `query` is embedded and searched; hits are
   * scored with importance x relevance x recency, then access is recorded.
   */
  async retrieve(query: MemoryRetrievalQuery): Promise<MemoryWithScore[]> {
    const now = this.now();
    const limit = Math.min(query.limit ?? 10, 100);

    if (query.query) {
      const rows = await this.embeddings.embed([query.query]);
      const vector = rows[0];
      if (!vector) {
        return [];
      }
      const hits = await this.repository.semanticSearch({
        tenantId: query.tenantId,
        vector,
        types: query.types ?? (query.type ? [query.type] : undefined),
        userId: query.userId ?? null,
        agentId: query.agentId ?? null,
        minImportance: query.minImportance ?? undefined,
        metadata: query.metadata,
        limit: limit * 3,
      });

      const scored = hits
        .filter((hit) => hit.similarity > 0.15)
        .map((hit) => {
          const relevance = Math.max(0, hit.similarity);
          const score = scoreMemoryRecord(hit.record, relevance, now);
          return { memory: hit.record, score, semanticScore: relevance, recencyScore: 1, importance: hit.record.importance };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      await this.touchAndLog(scored, query);
      return scored;
    }

    const rows = await this.repository.list(query, false);
    const scored = rows
      .map(({ memory }) => {
        const score = scoreMemoryRecord(memory, 0, now);
        return { memory, score, semanticScore: 0, recencyScore: 1, importance: memory.importance };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    await this.touchAndLog(scored, query);
    return scored;
  }

  /** Core engine-conformant recall (maps records back to core Memory). */
  async recall(query: MemoryQuery): Promise<Memory[]> {
    const results = await this.retrieve(memoryQueryToRetrieval(query));
    return results.map((result) => toCoreMemory(result.memory));
  }

  /** True forget: hard delete of one memory (cascades embeddings + events). */
  async forget(memoryId: string): Promise<boolean> {
    const record = await this.repository.getById(memoryId as never, undefined as never);
    if (!record) {
      return false;
    }
    return this.repository.hardDelete(record.id, record.tenantId);
  }

  /**
   * Background consolidation pass for one tenant: boosts the confidence of
   * consistently-reinforced memories. Returns the number of rows updated.
   */
  async consolidate(tenantId?: string): Promise<number> {
    if (!tenantId) {
      return 0;
    }
    const list = await this.repository.list({ tenantId: tenantId as never, limit: 1000 }, false);
    let touches = 0;
    for (const { memory } of list) {
      if (memory.accessCount >= 3 && memory.confidence < 1) {
        await this.repository.patch(memory.id, memory.tenantId, {
          confidence: Math.round(Math.min(memory.confidence + 0.05, 1) * 100) / 100,
        });
        touches += 1;
      }
    }
    return touches;
  }

  /** User-facing: mark as archived (soft delete) instead of hard deleting. */
  async archive(memoryId: string, tenantId: string): Promise<MemoryRecord | null> {
    const record = await this.repository.getById(memoryId as never, tenantId as never);
    if (!record) {
      return null;
    }
    const updated = await this.repository.patch(record.id, record.tenantId, { status: 'archived' });
    await this.repository.logEvent({
      memoryId: record.id,
      eventType: 'archived',
      actor: 'user',
      actorUserId: record.userId,
      reason: 'user archived memory',
    });
    return updated;
  }

  async restore(memoryId: string, tenantId: string): Promise<MemoryRecord | null> {
    const record = await this.repository.getById(memoryId as never, tenantId as never);
    if (!record || record.status === 'active') {
      return record;
    }
    await this.repository.logEvent({
      memoryId: record.id,
      eventType: 'restored',
      actor: 'user',
      actorUserId: record.userId,
    });
    return this.repository.patch(record.id, record.tenantId, { status: 'active' });
  }

  /** User-controlled memory deletion: removes every memory owned by the user. */
  async deleteForUser(tenantId: string, userId: string): Promise<{ deleted: number }> {
    const deleted = await this.repository.deleteByOwnership(tenantId as never, userId as never);
    return { deleted };
  }

  /** In-place edit of a single memory (user review of what the agent learned). */
  async update(memoryId: string, tenantId: string, input: UpdateMemoryInput): Promise<MemoryRecord | null> {
    const now = input.now ?? this.now();
    const current = await this.repository.getById(memoryId as never, tenantId as never);
    if (!current) {
      return null;
    }

    const nextContent = input.content ?? current.content;
    const nextHash = input.content
      ? contentHash({
          tenantId: current.tenantId,
          userId: current.userId,
          type: current.type,
          content: input.content,
          memoryKey: current.memoryKey ?? undefined,
        })
      : current.contentHash;

    const patched = await this.repository.patch(current.id, current.tenantId, {
      ...(input.content !== undefined ? { content: input.content, contentHash: nextHash } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      ...(input.importance !== undefined ? { importance: input.importance } : {}),
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      ...(input.explicit !== undefined ? { explicit: input.explicit } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.memoryKey !== undefined ? { memoryKey: input.memoryKey } : {}),
      ...{ updatedAt: now },
    });

    if (patched) {
      await this.repository.logEvent({
        memoryId: patched.id,
        eventType: 'updated',
        actor: input.actor ?? 'user',
        actorUserId: input.actorUserId ? (input.actorUserId as never) : current.userId,
        reason: input.reason ?? 'user updated memory',
        changed: { content: input.content, importance: input.importance, instrumentKey: input.memoryKey },
        occurredAt: now,
      });
    }

    return patched;
  }

  /** Paged, filterable listing for inspection UIs. No access-touch side effects. */
  async list(query: MemoryRetrievalQuery): Promise<MemoryListEntry[]> {
    return this.repository.list(query, false);
  }

  async get(memoryId: string, tenantId: string): Promise<MemoryRecord | null> {
    return this.repository.getById(memoryId as never, tenantId as never);
  }

  /** Provenance history for one memory (created/recalled/updated/archived…). */
  async events(
    memoryId: string,
    limit?: number,
  ): Promise<import('./repository.js').MemoryEventView[]> {
    return this.repository.eventsForMemory(memoryId as never, limit);
  }

  /** Hard-delete one memory (cascades its embeddings + event rows). */
  async hardDelete(memoryId: string, tenantId: string): Promise<boolean> {
    const record = await this.repository.getById(memoryId as never, tenantId as never);
    if (!record) {
      return false;
    }
    await this.repository.logEvent({
      memoryId: record.id,
      eventType: 'deleted',
      actor: 'user',
      actorUserId: record.userId,
      reason: 'user deleted memory',
    });
    await this.repository.hardDelete(record.id, record.tenantId);
    return true;
  }

  async summary(tenantId: string, userId?: string): Promise<Record<MemoryType, number>> {
    return this.repository.countByType(tenantId as never, (userId as never) ?? null);
  }

  /** Builds a token-capped prompt context from the five memory buckets. */
  async buildContext(query: MemoryRetrievalQuery, options: ContextBuildOptions = {}): Promise<ContextBundle> {
    const buckets = await Promise.all(
      (['working', 'episodic', 'semantic', 'procedural', 'conversation'] as MemoryType[]).map(async (type) => {
        const memories = await this.retrieve({
          ...query,
          types: [type],
          limit: Math.min(options.maxItemsPerBucket ?? 8, 16),
        });
        return { type, memories };
      }),
    );
    return buildContext(buckets, options);
  }

  /** Prevent unbounded memory growth by removing stale working memories for a tenant. */
  async sweep(
    tenantId: string,
    types: MemoryType[] = ['working'],
    olderThanDays = 7,
  ): Promise<number> {
    const cutoff = new Date(this.now().getTime() - olderThanDays * 86400000);
    const rows = await this.repository.list({ tenantId: tenantId as never, limit: 1000 }, false);
    let removed = 0;
    for (const { memory } of rows) {
      if (types.includes(memory.type) && memory.updatedAt < cutoff && memory.accessCount < 2) {
        if (await this.repository.hardDelete(memory.id, memory.tenantId)) {
          removed += 1;
        }
      }
    }
    return removed;
  }

  /** Convenience: set/replace a typed piece of working memory by logical key. */
  async setWorkingMemory(input: {
    tenantId: string;
    userId?: string;
    memoryKey: string;
    content: string;
    metadata?: Record<string, unknown>;
    importance?: number;
    now?: Date;
  }): Promise<StoreResult> {
    return this.store({
      tenantId: input.tenantId as never,
      userId: (input.userId ?? null) as never,
      type: 'working',
      memoryKey: input.memoryKey,
      content: input.content,
      metadata: input.metadata,
      importance: input.importance ?? 0.75,
      explicit: true,
      source: 'system',
      now: input.now,
    });
  }

  async setWorkingTask(task: string, ctx: { tenantId: string; userId?: string }): Promise<StoreResult> {
    return this.setWorkingMemory({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      memoryKey: 'working:task',
      content: task,
    });
  }

  private async updateContentInPlace(
    existing: MemoryRecord,
    input: StoreMemoryInput,
    now: Date,
  ): Promise<MemoryRecord> {
    const nextHash = contentHash({
      tenantId: existing.tenantId,
      userId: existing.userId,
      type: existing.type,
      content: input.content,
      memoryKey: input.memoryKey ?? existing.memoryKey ?? undefined,
    });
    const updated = await this.repository.patch(existing.id, existing.tenantId, {
      content: input.content,
      contentHash: nextHash,
      metadata: input.metadata ?? existing.metadata,
      importance: Math.max(existing.importance, input.importance ?? existing.importance),
      confidence: Math.max(existing.confidence, input.confidence ?? existing.confidence),
      explicit: input.explicit ?? existing.explicit,
      status: 'active',
      updatedAt: now,
    });
    await this.repository.logEvent({
      memoryId: existing.id,
      eventType: 'updated',
      actor: 'agent',
      actorUserId: existing.userId,
      reason: `refreshed same ${existing.type} memory`,
      changed: { content: input.content, memoryKey: input.memoryKey },
      occurredAt: now,
    });
    return updated ?? existing;
  }

  private async embedAndStore(record: MemoryRecord): Promise<void> {
    const rows = await this.embeddings.embed([record.content]);
    const vector = rows[0];
    if (!vector || vector.length === 0) {
      return;
    }
    await this.repository.insertEmbedding({
      memoryId: record.id,
      embedding: vector,
      model: this.embeddings.model,
      dimensions: this.embeddings.dimensions,
    });
  }

  private async touchAndLog(scored: MemoryWithScore[], query: MemoryRetrievalQuery): Promise<void> {
    if (scored.length === 0) {
      return;
    }
    const now = this.now();
    for (const { memory } of scored) {
      await this.repository.touch(memory.id, memory.tenantId, now);
      await this.repository.logEvent({
        memoryId: memory.id,
        eventType: 'recalled',
        actor: 'agent',
        actorUserId: query.userId ?? memory.userId,
        reason: query.query ? `recalled for: ${truncate(query.query, 120)}` : 'recalled for context',
        occurredAt: now,
      });
    }
  }

  private conversationSummary(turn: TurnContext): string | null {
    const parts: string[] = [];
    if (turn.userText && turn.userText.trim()) {
      parts.push(`User: ${truncate(turn.userText, 512)}`);
    }
    if (turn.assistantText && turn.assistantText.trim()) {
      parts.push(`Assistant: ${truncate(turn.assistantText, 512)}`);
    }
    for (const tool of turn.toolResults ?? []) {
      parts.push(`Tool ${tool.tool}: ${truncate(tool.result, 200)}`);
    }
    const summary = parts.join('\n');
    return summary.length > 0 ? summary : null;
  }
}

function memoryQueryToRetrieval(query: MemoryQuery): MemoryRetrievalQuery {
  if (!query.tenantId) {
    throw new Error('recall/retrieve requires a tenantId on the query (memory is tenant-scoped)');
  }
  return {
    tenantId: query.tenantId,
    userId: query.userId,
    conversationId: query.conversationId,
    types: query.types,
    status: query.status as never,
    memoryKey: query.memoryKey,
    minImportance: query.minImportance,
    metadata: query.metadata,
    query: query.query,
    limit: query.limit ?? 10,
    offset: query.offset,
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Adapter exposing the manager through the core MemoryEngine contract.
 */
export function toEngine(manager: MemoryManager): MemoryEngine {
  return {
    async store(input) {
      const result = await manager.store({
        tenantId: (input.tenantId ?? '00000000-0000-0000-0000-000000000000') as never,
        userId: (input.userId ?? null) as never,
        agentId: input.provenance?.agentId ?? input.agentId ?? null,
        conversationId: (input.provenance?.conversationId ?? null) as never,
        sessionId: (input.provenance?.sessionId ?? null) as never,
        type: input.type,
        memoryKey: input.memoryKey,
        content: input.content,
        metadata: input.metadata,
        importance: input.importance,
        explicit: input.provenance.explicit,
        source: input.provenance.source,
        evidence: input.provenance.evidence,
        confidence: input.provenance.confidence,
        now: input.provenance.learnedAt,
      });
      return toCoreMemory(result.memory);
    },
    recall: (query) => manager.recall(query),
    forget: (memoryId) => manager.forget(memoryId),
    consolidate: () => manager.consolidate(),
  };
}