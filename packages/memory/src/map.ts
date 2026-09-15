import type { Memory } from '@hermes/core';
import type { MemoryRecord } from './types.js';

/**
 * Records are stored with their provenance flattened into columns; this
 * reassembles the core Memory contract (with a provenance object) so the
 * MemoryEngine abstraction works over the same data.
 */
export function toCoreMemory(record: MemoryRecord): Memory {
  return {
    id: record.id,
    tenantId: record.tenantId,
    userId: record.userId ?? undefined,
    agentId: record.agentId ?? undefined,
    type: record.type,
    memoryKey: record.memoryKey ?? undefined,
    content: record.content,
    contentHash: record.contentHash,
    metadata: record.metadata,
    importance: record.importance,
    provenance: {
      source: record.source,
      conversationId: record.conversationId ?? undefined,
      sessionId: record.sessionId ?? undefined,
      agentId: record.agentId ?? undefined,
      learnedAt: record.createdAt,
      confidence: record.confidence,
      explicit: record.explicit,
      evidence: typeof record.metadata['_evidence'] === 'string' ? record.metadata['_evidence'] : undefined,
    },
    status: record.status,
    accessCount: record.accessCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastAccessedAt: record.lastAccessedAt,
    expiresAt: record.expiresAt ?? undefined,
  };
}