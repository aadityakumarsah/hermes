import type { ConversationId, MemoryId, UserId } from './id.js';

export type MemoryType = 'working' | 'long_term' | 'episodic' | 'procedure';
export type MemorySource = 'conversation' | 'import' | 'consolidation' | 'system';

/**
 * A unit of stored memory retrieved for agent context.
 */
export interface Memory {
  id: MemoryId;
  type: MemoryType;
  content: string;
  embeddingId?: string;
  metadata: Record<string, unknown>;
  importance: number;
  source: MemorySource;
  conversationId?: ConversationId;
  createdAt: Date;
  lastAccessedAt?: Date;
  expiresAt?: Date;
}

export interface MemoryQuery {
  userId?: UserId;
  conversationId?: ConversationId;
  types?: MemoryType[];
  query?: string;
  limit?: number;
  minImportance?: number;
}

export interface MemoryEngine {
  store(memory: Omit<Memory, 'id' | 'createdAt' | 'lastAccessedAt'>): Promise<Memory>;
  recall(query: MemoryQuery): Promise<Memory[]>;
  forget(memoryId: MemoryId): Promise<void>;
  consolidate(): Promise<number>;
}