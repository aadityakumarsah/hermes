import 'dotenv/config';
import type { ConversationId, SessionId, TenantId, UserId, Logger } from '@hermes/core';
import { createDatabaseClient, tenants, users, agents } from '@hermes/storage';
import { HashEmbeddingProvider, MemoryManager } from '@hermes/memory';

const TENANT = (process.env['HERMES_TENANT_ID'] ?? '11111111-1111-4111-8111-111111111111') as TenantId;
const USER = (process.env['HERMES_USER_ID'] ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as UserId;

const logger: Logger = {
  debug() {},
  info(msg: string) {
    console.log(msg);
  },
  warn(msg: string) {
    console.warn(msg);
  },
  error(msg: string, extra?: unknown) {
    console.error(msg, extra ?? '');
  },
};

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const client = createDatabaseClient({ url, maxConnections: 5, ssl: false }, logger);
const manager = new MemoryManager({ db: client.db, embeddings: new HashEmbeddingProvider() });

async function ensureTenant() {
  const db = client.db;
  await db.insert(tenants).values({ id: TENANT, name: 'demo-tenant' }).onConflictDoNothing();
  await db.insert(users).values({ id: USER, tenantId: TENANT, email: 'ada@hermes.demo' }).onConflictDoNothing();
  await db
    .insert(agents)
    .values({ id: DEMO_AGENT, tenantId: TENANT, name: 'hermes-demo' })
    .onConflictDoNothing();
}

const DEMO_AGENT = '00000000-0000-4000-8000-0000000000aa';

function hr(label: string) {
  console.log(`\n${'─'.repeat(60)}\n  ${label}\n${'─'.repeat(60)}`);
}

async function main() {
  await ensureTenant();

  hr('SESSION 1 — First conversation (storing memories)');
  const conv1 = 'aaaa0000-0000-4000-8000-000000000001' as ConversationId;
  const sess1 = 'bbbb0000-0000-4000-8000-000000000001' as SessionId;

  const turns = [
    { userText: 'Hi! My name is Ada and I work at Hermes.' },
    { userText: 'I prefer TypeScript over JavaScript for backend work.' },
    { userText: 'My project is a memory-rich AI agent with pgvector.' },
    { userText: "I'm currently working on the reconciliation service." },
  ];

  for (const turn of turns) {
    const result = await manager.ingest({
      tenantId: TENANT,
      userId: USER,
      agentId: DEMO_AGENT,
      conversationId: conv1,
      sessionId: sess1,
      ...turn,
    });
    console.log(`  [ingest] extracted=${result.extracted} stored=${result.stored.length} — "${turn.userText}"`);
  }

  const summary1 = await manager.summary(TENANT, USER);
  console.log('\n  Memory summary after Session 1:', summary1);

  hr('SESSION 2 — New conversation (retrieving memories)');
  const conv2 = 'aaaa0000-0000-4000-8000-000000000002' as ConversationId;

  await manager.ingest({
    tenantId: TENANT,
    userId: USER,
    conversationId: conv2,
    userText: 'Hey again! Quick question for you.',
  });

  const questions = [
    "What is the user's name?",
    'What language does the user prefer?',
    "What is the user's project about?",
    'What is the user currently working on?',
  ];

  for (const q of questions) {
    const hits = await manager.retrieve({ tenantId: TENANT, userId: USER, query: q, limit: 1 });
    const top = hits[0];
    console.log(`\n  Q: "${q}"`);
    if (top) {
      console.log(`  A: ${top.memory.content}`);
      console.log(`     type=${top.memory.type} score=${top.score.toFixed(3)} importance=${top.memory.importance}`);
    } else {
      console.log('  A: (no relevant memory found)');
    }
  }

  hr('CONTEXT BUNDLE (what the agent sees in its prompt)');
  const bundle = await manager.buildContext({ tenantId: TENANT, userId: USER, query: 'continue the conversation' }, { targetTokens: 600 });
  console.log(bundle.toPromptText());
  console.log(`\n  total tokens: ${bundle.totalTokens}`);

  hr('USER-CONTROLLED MEMORY REVIEW');
  const memList = await manager.list({ tenantId: TENANT, userId: USER, limit: 10 });
  for (const entry of memList) {
    const m = entry.memory;
    console.log(`  [${m.type}] ${m.content.slice(0, 80)}${m.content.length > 80 ? '…' : ''}`);
  }

  hr('DONE');
  await client.close();
}

main().catch(async (err) => {
  console.error('Demo failed:', err);
  await client.close().catch(() => undefined);
  process.exit(1);
});