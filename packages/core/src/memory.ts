import type { ConversationId, MemoryId, SessionId, TenantId, UserId } from './id.js';

/**
 * The five memory systems. A well-behaved agent recalls the right slice per
 * turn rather than dumping everything into the prompt.
 *
 * - working:    current conversation, current task, temporary state (ephemeral)
 * - episodic:   previous conversations, important events, completed tasks
 * - semantic:   facts about users, preferences, projects, relationships, knowledge
 * - procedural: learned workflows, reusable procedures, successful patterns
 * - conversation: raw message history (tool calls + results)
 */
export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural' | 'conversation';

export type MemorySource = 'conversation' | 'import' | 'consolidation' | 'system' | 'api';
export type MemoryStatus = 'active' | 'archived' | 'deleted';
export type MemoryActor = 'user' | 'agent' | 'system' | 'api';

/**
 * Provenance: who, what, when, where, why, and how confidently we believe it.
 */
export interface MemoryProvenance {
  source: MemorySource;
  conversationId?: ConversationId;
  sessionId?: SessionId;
  agentId?: string;
  /** The quote the memory was extracted from, when available. */
  evidence?: string;
  learnedAt?: Date;
  /** 0..1 how sure we are this memory is true. */
  confidence: number;
  /** Whether the user explicitly stated it vs. the agent inferred it. */
  explicit: boolean;
}

export interface Memory {
  id: MemoryId;
  tenantId?: TenantId;
  /** The principal this memory is about / visible to. */
  userId?: UserId;
  agentId?: string;
  type: MemoryType;
  /**
   * Stable logical key used for idempotent updates and working-memory KV
   * (e.g. 'working:task', 'semantic:preference:language').
   */
  memoryKey?: string;
  content: string;
  /** sha256 of normalized content + type + owner scope, for dedup. */
  contentHash: string;
  metadata: Record<string, unknown>;
  importance: number;
  provenance: MemoryProvenance;
  status: MemoryStatus;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt?: Date;
  expiresAt?: Date;
}

export interface MemoryQuery {
  tenantId?: TenantId;
  userId?: UserId;
  conversationId?: ConversationId;
  types?: MemoryType[];
  status?: MemoryStatus | MemoryStatus[];
  memoryKey?: string;
  minImportance?: number;
  /** Exact-match metadata filters: `{ tag: 'typescript' }`. */
  metadata?: Record<string, unknown>;
  /** Free-text / semantic query. When set, results are ranked by relevance. */
  query?: string;
  limit?: number;
  offset?: number;
}

/**
 * The durable memory subsystem contract. The implementation in packages/memory
 * layers provenance, embeddings, extraction, and ranking on top of PostgreSQL.
 */
export interface MemoryEngine {
  store(input: CreateMemoryInput): Promise<Memory>;
  recall(query: MemoryQuery): Promise<Memory[]>;
  forget(memoryId: MemoryId): Promise<boolean>;
  consolidate(): Promise<number>;
}

export type CreateMemoryInput = Omit<
  Memory,
  'id' | 'contentHash' | 'status' | 'accessCount' | 'createdAt' | 'updatedAt' | 'lastAccessedAt'
> & { contentHash?: string };