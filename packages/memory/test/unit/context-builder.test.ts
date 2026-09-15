import { describe, expect, it } from 'vitest';
import { buildContext, estimateTokens } from '../../src/context-builder.js';
import type { ContextBucket, MemoryWithScore } from '../../src/types.js';
import type { MemoryType } from '@hermes/core';

function item(type: MemoryType, content: string): MemoryWithScore {
  return {
    memory: {
      id: 'm',
      tenantId: 't' as never,
      userId: null,
      agentId: null,
      conversationId: null,
      sessionId: null,
      type,
      memoryKey: null,
      content,
      contentHash: 'hash',
      metadata: {},
      importance: 0.8,
      confidence: 0.9,
      explicit: true,
      source: 'conversation',
      status: 'active',
      accessCount: 0,
      lastAccessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    },
    score: 0.9,
    semanticScore: 0.9,
    recencyScore: 1,
    importance: 0.8,
  };
}

const bucket = (type: MemoryType, contents: string[]): ContextBucket => ({
  type,
  memories: contents.map((content) => item(type, content)),
});

describe('buildContext', () => {
  it('binds the total size to the token budget', () => {
    const bundle = buildContext(
      [
        bucket('working', ['Fix the billing webhook.']),
        bucket('semantic', ['The user prefers dark mode', 'The user’s project is Hermes Agent']),
        bucket('episodic', ['Deployed the reconciliation service']),
      ],
      { targetTokens: 40 },
    );
    expect(bundle.totalTokens).toBeLessThanOrEqual(45);
  });

  it('groups memories by bucket label, highest relevance first', () => {
    const bundle = buildContext(
      [
        bucket('working', ['Current: migrate auth flows']),
        bucket('semantic', ['Prefers TypeScript', 'Name is Ada']),
      ],
      { targetTokens: 1000 },
    );
    const prompt = bundle.toPromptText();
    expect(prompt).toContain('CURRENT TASK');
    expect(prompt).toContain('Prefers TypeScript');
  });

  it('caps items per bucket', () => {
    const bundle = buildContext([bucket('semantic', Array.from({ length: 50 }, (_, i) => `fact ${i}`))], {
      targetTokens: 100_000,
      maxItemsPerBucket: 3,
    });
    expect(bundle.buckets[0]?.memories).toHaveLength(3);
  });

  it('truncates long entries', () => {
    const bundle = buildContext([bucket('semantic', ['x'.repeat(2000)])], { contentMaxCharacters: 20 });
    expect(bundle.buckets[0]?.memories[0]?.memory.content.length).toBeLessThanOrEqual(21);
  });

  it('omits empty buckets unless asked to keep them', () => {
    const empty = buildContext([bucket('conversation', [])], { includeEmptyBuckets: false });
    expect(empty.buckets).toHaveLength(0);
    const kept = buildContext([bucket('conversation', [])], { includeEmptyBuckets: true });
    expect(kept.buckets).toHaveLength(1);
  });
});

describe('estimateTokens', () => {
  it('estimates roughly 4 chars per token', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});