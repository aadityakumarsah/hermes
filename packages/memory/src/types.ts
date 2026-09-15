import type {
  ConversationId,
  MemoryId,
  MemorySource,
  MemoryStatus,
  MemoryType,
  SessionId,
  TenantId,
  UserId,
} from '@hermes/core';

/** A memory as persisted in PostgreSQL. */
export interface MemoryRecord {
  id: MemoryId;
  tenantId: TenantId;
  userId: UserId | null;
  agentId: string | null;
  conversationId: ConversationId | null;
  sessionId: SessionId | null;
  type: MemoryType;
  memoryKey: string | null;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  importance: number;
  confidence: number;
  explicit: boolean;
  source: MemorySource;
  status: MemoryStatus;
  accessCount: number;
  lastAccessedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

/** One conversational turn flowing through the memory lifecycle. */
export interface TurnContext {
  tenantId: TenantId;
  userId?: UserId;
  agentId?: string;
  conversationId?: ConversationId;
  sessionId?: SessionId;
  userText?: string;
  assistantText?: string;
  toolResults?: Array<{ tool: string; result: string }>;
  now?: Date;
}

export interface StoreMemoryInput {
  tenantId: TenantId;
  userId?: UserId | null;
  agentId?: string | null;
  conversationId?: ConversationId | null;
  sessionId?: SessionId | null;
  type: MemoryType;
  memoryKey?: string;
  content: string;
  /** When set, used as the idempotency key (dedup) instead of content hashing. */
  metadata?: Record<string, unknown>;
  importance?: number;
  explicit?: boolean;
  confidence?: number;
  source?: MemorySource;
  evidence?: string;
  expiresAt?: Date | null;
  now?: Date;
}

export interface StoreResult {
  memory: MemoryRecord;
  /** True when an existing non-deleted memory already covered this content. */
  deduplicated: boolean;
  /** True when the store was an in-place productivity update of an existing row. */
  updated: boolean;
  created: boolean;
}

export interface MemoryWithScore {
  memory: MemoryRecord;
  score: number;
  semanticScore: number;
  recencyScore: number;
  importance: number;
}

/** Retrieval query options (superset of core MemoryQuery). */
export interface MemoryRetrievalQuery {
  tenantId: TenantId;
  userId?: UserId;
  agentId?: string;
  conversationId?: ConversationId;
  source?: MemorySource;
  types?: MemoryType[];
  type?: MemoryType;
  status?: MemoryStatus | MemoryStatus[];
  memoryKey?: string;
  minImportance?: number;
  metadata?: Record<string, unknown>;
  query?: string;
  /** Unused if query is unset (returns filtered rows ordered by importance). */
  limit?: number;
  offset?: number;
}

export interface MemoryListEntry {
  memory: MemoryRecord;
  /** Semantic similarity of the last search, when a query was used. */
  score?: number;
  /** Number of rows in memory_events for this memory (optional, loaded on demand). */
  eventCount?: number;
}

export interface ContextBucket {
  type: MemoryType;
  memories: MemoryWithScore[];
}

export interface ContextBundle {
  buckets: ContextBucket[];
  totalTokens: number;
  toPromptText(): string;
}