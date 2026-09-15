import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MemoryId, TenantId } from '@hermes/core';
import { HashEmbeddingProvider } from '../../src/embeddings/hashing.js';
import { MemoryManager } from '../../src/manager.js';
import { setupTestDb, type TestDbContext } from '../helpers.js';

describe('memory retrieval (pgvector)', () => {
  let ctx: TestDbContext | undefined;
  let manager: MemoryManager | undefined;

  beforeAll(async () => {
    ctx = await setupTestDb();
    manager = new MemoryManager({ db: ctx.db, embeddings: new HashEmbeddingProvider() });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('ranks semantically-relevant memories above unrelated ones', async () => {
    const tenantId = ctx!.tenantId;
    const userId = ctx!.userId;

    await manager!.store({
      tenantId,
      userId,
      type: 'semantic',
      content: 'The user prefers dark mode over light mode.',
      importance: 0.5,
      explicit: true,
    });
    await manager!.store({
      tenantId,
      userId,
      type: 'semantic',
      content: 'The user is planning a trip to the Swiss Alps.',
      importance: 0.9,
      explicit: true,
    });

    const hits = await manager!.retrieve({
      tenantId,
      userId,
      query: 'dark mode color theme preference',
      limit: 5,
    });

    expect(hits.length).toBeGreaterThan(0);
    const top = hits[0];
    expect(top?.memory.content).toContain('dark mode');
  });

  it('respects the type filter', async () => {
    const hits = await manager!.retrieve({
      tenantId: ctx!.tenantId,
      userId: ctx!.userId,
      types: ['working'],
      limit: 5,
    });
    expect(hits.every((hit) => hit.memory.type === 'working')).toBe(true);
  });

  it('respects exact-match metadata filters', async () => {
    const tenantId = ctx!.tenantId;
    const userId = ctx!.userId;

    await manager!.store({
      tenantId,
      userId,
      type: 'semantic',
      content: 'The user scripts their build with a Makefile.',
      importance: 0.5,
      metadata: { skill: 'makefile' },
    });
    await manager!.store({
      tenantId,
      userId,
      type: 'semantic',
      content: 'The user scripts their build with pnpm.',
      importance: 0.5,
      metadata: { skill: 'pnpm' },
    });

    const hits = await manager!.retrieve({
      tenantId,
      userId,
      metadata: { skill: 'makefile' },
      limit: 5,
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.memory.metadata['skill'] === 'makefile')).toBe(true);
  });

  it('records access and emits recall events', async () => {
    const tenantId = ctx!.tenantId;
    const userId = ctx!.userId;

    const stored = await manager!.store({
      tenantId,
      userId,
      type: 'semantic',
      content: 'The user contributes to an open-source vector database.',
      importance: 0.6,
    });
    const id: MemoryId = stored.memory.id;

    const before = stored.memory.accessCount;
    await manager!.retrieve({ tenantId, userId, query: 'vector database open source', limit: 3 });
    await manager!.retrieve({ tenantId, userId, query: 'vector database open source', limit: 3 });

    const after = await manager!.get(id, tenantId);
    expect(after?.accessCount).toBeGreaterThanOrEqual(before + 2);

    const events = await manager!.events(id);
    expect(events.some((event) => event.eventType === 'recalled')).toBe(true);
  });
});