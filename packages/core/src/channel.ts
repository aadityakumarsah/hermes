export type ChannelId = string;

export enum ChannelState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Error = 'error',
}

/**
 * Contract implemented by every channel adapter (Slack, WhatsApp, Web). The
 * Hermes core treats channels uniformly through this interface.
 */
export interface ChannelAdapter {
  readonly id: ChannelId;
  readonly label: string;

  start(): Promise<void>;
  stop(): Promise<void>;

  /** Deliver a normalized outbound message to the channel. */
  send(message: import('./message.js').OutboundMessage): Promise<void>;

  /** Send a transient typing indicator. */
  sendTyping(channelConversationId: string): Promise<void>;

  getState(): ChannelState;
  healthCheck(): Promise<ChannelHealth>;
}

export interface ChannelHealth {
  id: ChannelId;
  state: ChannelState;
  connectedAt?: Date;
  lastError?: string;
  latencyMs?: number;
}

export interface ChannelConnector {
  id: ChannelId;
  createAdapter(services: ChannelServices): Promise<ChannelAdapter>;
}

/**
 * Minimal service access for adapters. Extended as the runtime grows.
 */
export interface ChannelServices {
  publishEvent(event: import('./events.js').HermesEvent): Promise<void>;
}