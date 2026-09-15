import { serve, type ServerType } from '@hono/node-server';
import { Hono, type Context, type Next } from 'hono';
import { createNodeWebSocket, type NodeWebSocket } from '@hono/node-ws';
import type { HermesConfig } from '@hermes/config';
import type { Logger } from '@hermes/core';
import { HERMES_VERSION } from '@hermes/core';
import type { DatabaseClient, HermesDatabase, RedisBus } from '@hermes/storage';
import { JoseTokenService } from '@hermes/auth';
import { authMiddleware } from '@hermes/auth';
import { HashEmbeddingProvider, MemoryManager, type EmbeddingProvider } from '@hermes/memory';
import { memoryRoutes } from './routes/memories.js';

export interface ServerDeps {
  config: HermesConfig;
  logger: Logger;
  db: DatabaseClient;
  redisBus: RedisBus;
  embeddings?: EmbeddingProvider;
}

export interface HermesAppEnv {
  Bindings: {
    logger: Logger;
    db: HermesDatabase;
    config: HermesConfig;
  };
  Variables: {
    logger: Logger;
    db: HermesDatabase;
    redis: RedisBus['redis'];
    config: HermesConfig;
    memory?: MemoryManager;
    'hermes.auth': { user?: { sub: string; tenantId?: string; role?: string } } | undefined;
  };
}

export interface BootResult {
  app: Hono<HermesAppEnv>;
  server: ServerType;
  ws: NodeWebSocket;
  close(): Promise<void>;
}

export async function startServer(deps: ServerDeps): Promise<BootResult> {
  const { config, logger, db, redisBus } = deps;
  const tokenService = new JoseTokenService(config.auth);
  const memoryManager = new MemoryManager({
    db: db.db,
    embeddings: deps.embeddings ?? new HashEmbeddingProvider(),
    logger,
  });

  const app = new Hono<HermesAppEnv>();
  const nodeWs = createNodeWebSocket({ app });
  const { injectWebSocket, upgradeWebSocket } = nodeWs;

  app.use(async (c: Context<HermesAppEnv>, next: Next) => {
    c.set('logger', logger);
    c.set('db', db.db);
    c.set('redis', redisBus.redis);
    c.set('config', config);
    c.set('memory', memoryManager);
    await next();
  });

  app.use('/api/*', authMiddleware({ tokenService }));

  app.get('/health', async (c: Context<HermesAppEnv>) => {
    const status: Record<string, unknown> = {
      status: 'ok',
      version: HERMES_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
    };

    try {
      await db.pool.query('SELECT 1');
      status.database = 'ok';
    } catch (err) {
      status.database = 'error';
      status.status = 'degraded';
      logger.error('health check database failure', { error: String(err) });
    }

    return c.json(status);
  });

  app.get('/api/health', (c: Context<HermesAppEnv>) => c.json({ status: 'ok', version: HERMES_VERSION }));

  app.get('/api/v1/version', (c: Context<HermesAppEnv>) => {
    const auth = c.get('hermes.auth');
    return c.json({ name: 'hermes', version: HERMES_VERSION, authenticated: Boolean(auth?.user) });
  });

  app.route('/api/v1/memories', memoryRoutes);

  app.get(
    '/ws',
    upgradeWebSocket((_c: Context<HermesAppEnv>) => ({
      onOpen: (_evt, ws) => {
        ws.send(JSON.stringify({ type: 'connected' }));
      },
      onMessage: (evt, ws) => {
        ws.send(JSON.stringify({ type: 'echo', data: String(evt.data) }));
      },
      onClose: (_evt, ws) => {
        ws.close();
      },
    })),
  );

  const server = serve(
    {
      fetch: app.fetch,
      port: config.server.port,
      hostname: config.server.host,
    },
    () => undefined,
  );

  injectWebSocket(server);

  return {
    app,
    server,
    ws: nodeWs,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}