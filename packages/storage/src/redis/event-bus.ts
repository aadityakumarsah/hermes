import type { Redis } from 'ioredis';
import type { HermesEvent, HermesEventType, EventPublisher, Logger } from '@hermes/core';

/**
 * Event publisher/subscriber backed by Redis pub/sub. One shared connection
 * publishes; each subscriber acquires its own connection for pattern PSUBSCRIBE.
 */
export class RedisEventBus implements EventPublisher {
  private subscriberConnected = false;
  private readonly handlers = new Map<HermesEventType, Set<(event: HermesEvent) => void>>();
  private readonly wildcardHandlers = new Set<(event: HermesEvent) => void>();

  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  async publish(event: HermesEvent): Promise<void> {
    await this.redis.publish(event.type, JSON.stringify(event));
  }

  subscribe(type: HermesEventType, handler: (event: HermesEvent) => void): () => void {
    let handlers = this.handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(type, handlers);
    }
    handlers.add(handler);
    void this.ensureSubscribed().catch((err) =>
      this.logger.error('failed to subscribe to redis bus', { error: String(err) }),
    );
    return () => handlers?.delete(handler);
  }

  private async ensureSubscribed(): Promise<void> {
    if (this.subscriberConnected) return;
    const subscriber = this.redis.duplicate();
    await subscriber
      .psubscribe('*')
      .then(() => {
        this.subscriberConnected = true;
      });
    subscriber.on('pmessage', (_pattern, channel, message) => {
      try {
        const event = JSON.parse(message) as HermesEvent;
        this.dispatch(event);
      } catch (err) {
        this.logger.error('failed to parse event from redis', { error: String(err), channel });
      }
    });
  }

  private dispatch(event: HermesEvent): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          this.logger.error('event handler threw', { error: String(err), type: event.type });
        }
      }
    }
    for (const handler of this.wildcardHandlers) {
      handler(event);
    }
  }

  onAny(handler: (event: HermesEvent) => void): () => void {
    this.wildcardHandlers.add(handler);
    return () => this.wildcardHandlers.delete(handler);
  }
}