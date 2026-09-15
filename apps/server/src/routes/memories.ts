import { Hono, type Context } from 'hono';
import type { MemoryType, TenantId, UserId } from '@hermes/core';
import type { MemoryRetrievalQuery, StoreMemoryInput } from '@hermes/memory';
import type { MemoryManager } from '@hermes/memory';
import type { HermesAppEnv } from '../server.js';

const MEMORY_TYPES: MemoryType[] = ['working', 'episodic', 'semantic', 'procedural', 'conversation'];

/**
 * User-facing memory inspection and control:
 *
 *   GET    /api/v1/memories            list (filter by type/query/metadata)
 *   GET    /api/v1/memories/summary    counts by memory type
 *   GET    /api/v1/memories/:id        single memory + its provenance/event log
 *   POST   /api/v1/memories            create a memory explicitly
 *   PATCH  /api/v1/memories/:id        correct what the agent learned
 *   DELETE /api/v1/memories/:id        forget one memory
 */
export const memoryRoutes = new Hono<HermesAppEnv>();

function memoryManager(c: Context<HermesAppEnv>): MemoryManager {
  const manager = c.get('memory');
  if (!manager) {
    throw new Error('memory manager not configured');
  }
  return manager;
}

memoryRoutes.get('/summary', async (c: Context<HermesAppEnv>) => {
  const manager = memoryManager(c);
  const tenantId = authTenant(c);
  const summary = await manager.summary(tenantId, authUserId(c));
  return c.json({ counts: summary });
});

memoryRoutes.get('/search', async (c: Context<HermesAppEnv>) => {
  const manager = memoryManager(c);
  const q = c.req.query('q') ?? c.req.query('query');
  if (!q) {
    return c.json({ results: [] });
  }
  const query: MemoryRetrievalQuery = {
    tenantId: authTenant(c),
    userId: authUserId(c) as MemoryRetrievalQuery['userId'],
    query: q,
    types: parseTypeFilter(c.req.query('type')),
    limit: limitOf(c),
  };
  const ranked = await manager.retrieve(query);
  return c.json({
    results: ranked.map((hit) => ({
      memory: hit.memory,
      score: Number(hit.score.toFixed(4)),
      semanticScore: Number(hit.semanticScore.toFixed(4)),
    })),
  });
});

memoryRoutes.get('/', async (c: Context<HermesAppEnv>) => {
  const manager = memoryManager(c);
  const query: MemoryRetrievalQuery = {
    tenantId: authTenant(c),
    userId: authUserId(c) as MemoryRetrievalQuery['userId'],
    type: parseTypeFilter(c.req.query('type'))?.[0],
    types: parseTypeFilter(c.req.query('type')),
    memoryKey: c.req.query('memoryKey') ?? undefined,
    status: parseStatus(c.req.query('status')),
    limit: limitOf(c),
    offset: offsetOf(c),
  };
  const entries = await manager.list(query);
  return c.json({ memories: entries.map((entry) => entry.memory) });
});

memoryRoutes.get('/context', async (c: Context<HermesAppEnv>) => {
  const manager = memoryManager(c);
  const query: MemoryRetrievalQuery = {
    tenantId: authTenant(c),
    userId: authUserId(c) as MemoryRetrievalQuery['userId'],
    query: c.req.query('q') ?? undefined,
    limit: limitOf(c),
  };
  const bundle = await manager.buildContext(query, {
    targetTokens: Number(c.req.query('tokens') ?? 1200),
    maxItemsPerBucket: Number(c.req.query('perBucket') ?? 8),
  });
  return c.json({
    totalTokens: bundle.totalTokens,
    buckets: bundle.buckets.map((bucket) => ({
      type: bucket.type,
      count: bucket.memories.length,
      memories: bucket.memories.map((entry) => entry.memory),
    })),
    prompt: bundle.toPromptText(),
  });
});

memoryRoutes.get('/:id', async (c: Context<HermesAppEnv>) => {
  const manager = memoryManager(c);
  const record = await manager.get(memoryIdOf(c), authTenant(c));
  if (!record) {
    return c.json({ error: 'memory not found' }, 404);
  }
  const events = await manager.events(record.id);
  return c.json({ memory: record, events });
});

memoryRoutes.post('/', async (c: Context<HermesAppEnv>) => {
  const manager = memoryManager(c);
  const body = (await c.req.json().catch(() => null)) as Partial<StoreMemoryInput> | null;
  if (!body || typeof body.content !== 'string' || !body.content.trim()) {
    return c.json({ error: 'content is required' }, 400);
  }
  const type = body.type ?? 'semantic';
  if (!MEMORY_TYPES.includes(type)) {
    return c.json({ error: `type must be one of: ${MEMORY_TYPES.join(', ')}` }, 400);
  }
  const storeInput: StoreMemoryInput = {
    tenantId: authTenant(c),
    userId: (body.userId !== undefined ? body.userId : authUserId(c)) ?? null,
    type,
    content: body.content,
    memoryKey: body.memoryKey,
    metadata: body.metadata,
    importance: body.importance,
    explicit: body.explicit ?? true,
    source: 'api',
    evidence: body.evidence,
    expiresAt: body.expiresAt ?? null,
  };
  const result = await manager.store(storeInput);
  return c.json(
    {
      memory: result.memory,
      deduplicated: result.deduplicated,
      created: result.created,
    },
    result.created ? 201 : 200,
  );
});

memoryRoutes.patch('/:id', async (c: Context<HermesAppEnv>) => {
  const manager = memoryManager(c);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return c.json({ error: 'request body required' }, 400);
  }
  const record = await manager.update(memoryIdOf(c), authTenant(c), {
    content: typeof body.content === 'string' ? body.content : undefined,
    importance: typeof body.importance === 'number' ? body.importance : undefined,
    confidence: typeof body.confidence === 'number' ? body.confidence : undefined,
    explicit: typeof body.explicit === 'boolean' ? body.explicit : undefined,
    metadata: typeof body.metadata === 'object' && body.metadata !== null ? (body.metadata as Record<string, unknown>) : undefined,
    actor: 'user',
    actorUserId: authUserId(c),
    reason: typeof body.reason === 'string' ? body.reason : 'user review',

  });
  if (!record) {
    return c.json({ error: 'memory not found' }, 404);
  }
  return c.json({ memory: record });
});

memoryRoutes.delete('/:id', async (c: Context<HermesAppEnv>) => {
  const manager = memoryManager(c);
  const deleted = await manager.hardDelete(memoryIdOf(c), authTenant(c));
  return deleted ? c.json({ deleted: true }) : c.json({ error: 'memory not found' }, 404);
});

function authTenant(c: Context<HermesAppEnv>): TenantId {
  const tenantId = c.get('hermes.auth')?.user?.tenantId;
  return (tenantId ?? process.env['HERMES_TENANT_ID'] ?? '11111111-1111-4111-8111-111111111111') as TenantId;
}

function authUserId(c: Context<HermesAppEnv>): UserId | undefined {
  const sub = c.get('hermes.auth')?.user?.sub;
  return (sub ?? undefined) as UserId | undefined;
}

function memoryIdOf(c: Context<HermesAppEnv>): string {
  return c.req.param('id') ?? '';
}

function parseTypeFilter(raw: string | undefined): MemoryType[] | undefined {
  if (!raw) {
    return undefined;
  }
  const list = raw.split(',').filter((t): t is MemoryType => MEMORY_TYPES.includes(t as MemoryType));
  return list.length > 0 ? list : undefined;
}

function parseStatus(raw: string | undefined): 'active' | 'archived' | 'deleted' | undefined {
  if (raw === 'active' || raw === 'archived' || raw === 'deleted') {
    return raw;
  }
  return undefined;
}

function limitOf(c: Context<HermesAppEnv>): number {
  const raw = Number(c.req.query('limit'));
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 20;
}

function offsetOf(c: Context<HermesAppEnv>): number {
  const raw = Number(c.req.query('offset'));
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}