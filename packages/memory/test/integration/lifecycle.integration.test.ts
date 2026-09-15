import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConversationId, SessionId, TenantId, UserId } from '@hermes/core';
import { HashEmbeddingProvider } from '../../src/embeddings/hashing.js';
import { MemoryManager, toEngine } from '../../src/manager.js';
import { setupTestDb, type TestDbContext } from '../helpers.js';

describe('memory lifecycle (Postgres)', () => {
  let ctx: TestDbContext | undefined;
  let manager: MemoryManager | undefined;

  beforeAll(async () => {
    ctx = await setupTestDb();
    manager = new MemoryManager({ db: ctx.db, embeddings: new HashEmbeddingProvider() });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('ingest extracts facts into semantic memory with provenance', async () => {
    const result = await manager!.ingest({
      tenantId: ctx!.tenantId,
      userId: ctx!.userId,
      agentId: ctx!.agentId,
      conversationId: '11111111-1111-4111-8111-111111111111' as ConversationId,
      sessionId: '22222222-2222-4222-8222-222222222222' as SessionId,
      userText: 'Hi, my name is Ada and I prefer TypeScript over JavaScript.',
    });

    expect(result.extracted).toBeGreaterThanOrEqual(2);
    const nameFact = result.stored.find((s) => s.memory.memoryKey === 'semantic:identity:name');
    expect(nameFact?.memory.content).toContain('Ada');
    expect(nameFact?.memory.source).toBe('conversation');
    expect(nameFact?.memory.conversationId).toBe('11111111-1111-4111-8111-111111111111');
    expect(nameFact?.memory.confidence).toBeGreaterThan(0.5);
  });

  it('re-stating the same fact is deduplicated (no second row)', async () => {
    const tenantId = ctx!.tenantId;
    const userId = ctx!.userId;

    const first = await manager!.store({
      tenantId,
      userId,
      type: 'semantic',
      content: 'The user prefers coffee over tea.',
      explicit: true,
    });
    const second = await manager!.store({
      tenantId,
      userId,
      type: 'semantic',
      content: 'The user prefers coffee over tea.', // same normalized fact
      explicit: true,
    });

    expect(second.deduplicated).toBe(true);
    expect(second.created).toBe(false);
    expect(second.memory.id).toBe(first.memory.id);
    expect(second.memory.importance).toBeGreaterThanOrEqual(first.memory.importance);
  });

  it('recalls across sessions (cross-session memory)', async () => {
    const tenantId = ctx!.tenantId;
    const userId = ctx!.userId;

    // "Session 1"
    await manager!.ingest({
      tenantId,
      userId,
      agentId: ctx!.agentId,
      conversationId: '33333333-3333-4333-8333-333333333333' as ConversationId,
      sessionId: '44444444-4444-4444-8444-444444444444' as SessionId,
      userText: 'I use Vitest and prefer TypeScript over JavaScript.',
    });

    // "Session 2" — a different conversation, no shared state passed.
    const hits = await manager!.retrieve({
      tenantId,
      userId,
      query: 'what language does the user prefer, TypeScript or Python?',
      limit: 3,
    });

    // With hash embeddings and accumulated test data, the top hit may vary;
    // assert that at least one result contains "typescript"
    expect(hits.some((hit) => hit.memory.content.toLowerCase().includes('typescript'))).toBe(true);
    // Provenance columns were persisted:
    const tsHit = hits.find((hit) => hit.memory.content.toLowerCase().includes('typescript'));
    expect(tsHit?.memory.source).toBe('conversation');
  });

  it('working memory behaves as an upsert keyed by memoryKey', async () => {
    const tenantId = ctx!.tenantId;
    const userId = ctx!.userId;

    const a = await manager!.setWorkingMemory({
      tenantId,
      userId,
      memoryKey: 'working:task',
      content: 'Migrate the auth tokens service.',
    });
    const b = await manager!.setWorkingMemory({
      tenantId,
      userId,
      memoryKey: 'working:task',
      content: 'Migrate the auth tokens service (blocked on secrets).',
    });

    expect(b.memory.id).toBe(a.memory.id);
    expect(b.updated).toBe(true);
    expect(b.created).toBe(false);
    expect(b.memory.content).toContain('blocked on secrets');

    const list = await manager!.list({ tenantId, userId, types: ['working'], memoryKey: 'working:task' });
    expect(list).toHaveLength(1);
  });

  it('update() edits a record in place and records an event', async () => {
    const tenantId = ctx!.tenantId;
    const userId = ctx!.userId;

    const stored = await manager!.store({
      tenantId,
      userId,
      type: 'semantic',
      content: 'The user works at ACME Corp.',
      importance: 0.4,
    });

    const updated = await manager!.update(stored.memory.id, tenantId, {
      content: 'The user works at Globex Consulting.',
      importance: 0.85,
      actor: 'user',
      reason: 'user correction',
    });

    expect(updated?.content).toContain('Globex');
    expect(updated?.importance).toBe(0.85);
    expect(updated?.contentHash).not.toBe(stored.memory.contentHash);

    const events = await manager!.events(stored.memory.id);
    expect(events.some((event) => event.eventType === 'updated' && event.reason === 'user correction')).toBe(true);
  });

  it('archive + restore preserves content while hiding it from retrieval', async () => {
    const tenantId = ctx!.tenantId;
    const userId = ctx!.userId;

    const stored = await manager!.store({
      tenantId,
      userId,
      type: 'semantic',
      content: 'The user keeps a notebook of quadratic equations.',
      importance: 0.7,
    });

    const archived = await manager!.archive(stored.memory.id, tenantId);
    expect(archived?.status).toBe('archived');

    const afterArchive = await manager!.retrieve({ tenantId, userId, query: 'quadratic equations notebook', limit: 3 });
    expect(afterArchive.some((hit) => hit.memory.id === stored.memory.id)).toBe(false);

    const restored = await manager!.restore(stored.memory.id, tenantId);
    expect(restored?.status).toBe('active');
  });

  it('engine adapter round-trips core Memory with provenance', async () => {
    const engine = toEngine(manager!);
    const core = await engine.store({
      tenantId: ctx!.tenantId,
      userId: ctx!.userId,
      type: 'episodic',
      content: 'The user shipped the billing service last Friday.',
      metadata: {},
      importance: 0.6,
      provenance: { source: 'conversation', confidence: 0.7, explicit: true, evidence: 'I shipped the billing service.' },
    });

    expect(core.provenance.source).toBe('conversation');
    expect(core.provenance.confidence).toBe(0.7);
    expect(core.provenance.evidence).toBe('I shipped the billing service.');

    const recalled = await engine.recall({
      tenantId: ctx!.tenantId,
      userId: ctx!.userId,
      query: 'shipped billing service',
      limit: 3,
    });
    expect(recalled.some((memory) => memory.contentHash === core.contentHash)).toBe(true);
  });

  it('deleteForUser removes all of the user’s memory', async () => {
    const tenantId = ctx!.tenantId;
    const userId: UserId = '99999999-9999-4999-8999-999999999999' as UserId;

    await manager!.store({ tenantId, userId, type: 'semantic', content: 'The user likes turtles.' });
    await manager!.store({ tenantId, userId, type: 'episodic', content: 'The user visited Dublin.' });
    await manager!.store({ tenantId, userId, type: 'working', content: 'Task: reserve flights.', memoryKey: 'working:task' });

    const { deleted } = await manager!.deleteForUser(tenantId, userId);
    expect(deleted).toBe(3);

    const leftover = await manager!.list({ tenantId, userId });
    expect(leftover).toHaveLength(0);
  });
});