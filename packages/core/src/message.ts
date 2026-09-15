import type { ChannelId } from './channel.js';
import type { ChannelConversationId, ConversationId, MessageId, UserId } from './id.js';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export enum MessageSource {
  User = 'user',
  Agent = 'agent',
  System = 'system',
  Background = 'background',
}

export enum MessageStatus {
  Received = 'received',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
  Aborted = 'aborted',
}

export enum ChannelMessageKind {
  Text = 'text',
  Media = 'media',
  Reaction = 'reaction',
  Typing = 'typing',
  Event = 'event',
}

export interface MediaAttachment {
  mimeType: string;
  url?: string;
  data?: Uint8Array;
  fileName?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface CanonicalUser {
  userId: UserId;
  displayName?: string;
  channelUserIds: Partial<Record<ChannelId, string>>;
  isBot?: boolean;
}

/**
 * Normalized inbound message produced by channel adapters.
 */
export interface InboundMessage {
  type: 'inbound';
  id?: MessageId;
  channel: ChannelId;
  channelConversationId: ChannelConversationId;
  channelMessageId: string;
  threadId?: string;
  sender: CanonicalUser;
  kind: ChannelMessageKind;
  text?: string;
  attachments: MediaAttachment[];
  replyToMessageId?: string;
  mentionsAgent?: boolean;
  receivedAt: Date;
  raw?: unknown;
}

/**
 * Normalized outbound message rendered by channel adapters.
 */
export interface OutboundMessage {
  type: 'outbound';
  id?: MessageId;
  channel: ChannelId;
  channelConversationId: ChannelConversationId;
  threadId?: string;
  sender: CanonicalUser;
  kind: ChannelMessageKind;
  text?: string;
  attachments: MediaAttachment[];
  authoredBy?: 'assistant' | 'system' | 'background';
  inReplyToMessageId?: string;
  createdAt: Date;
}

export interface PersistedMessage {
  id: MessageId;
  conversationId: ConversationId;
  role: MessageRole;
  content: string;
  toolCalls?: unknown[];
  toolResults?: unknown[];
  metadata: Record<string, unknown>;
  createdAt: Date;
}