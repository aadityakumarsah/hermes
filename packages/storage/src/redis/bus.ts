import { Redis } from 'ioredis';
import type { RedisConfig } from '@hermes/config';
import type { HermesEvent, EventPublisher, Logger } from '@hermes/core';

export interface RedisBus {
  redis: Redis;
  publisher: EventPublisher;
  close(): Promise<void>;
}

export function createRedisBus(
  config: RedisConfig,
  logger: Logger,
  prefix: string = config.keyPrefix,
): RedisBus {
  const redis = new Redis(config.url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    keyPrefix: prefix,
  });

  redis.on('error', (err) => {
    logger.error('redis error', { error: err.message });
  });
  redis.on('ready', () => logger.debug('redis connected'));
  redis.on('close', () => logger.warn('redis connection closed'));

  // Own event bus instance distinct from subscriptions delivered by consumers.
  const publisher: EventPublisher = {
    publish: async (event: HermesEvent) => {
      await redis.publish(event.type, JSON.stringify(event));
    },
    subscribe: () => {
      logger.warn('subscribe() is a no-op on the raw publisher; use a subscribed bus');
      return () => {};
    },
  };

  return { redis, publisher, close: () => redis.quit().then(() => redis.disconnect()) };
}