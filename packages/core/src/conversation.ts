import type { ChannelId } from './channel.js';
import type { ChannelConversationId, ConversationId, TenantId, UserId } from './id.js';
import type { CanonicalUser } from './message.js';

export enum ConversationStatus {
  Active = 'active',
  Archived = 'archived',
  Muted = 'muted',
  Deleted = 'deleted',
}

/**
 * A conversation maps a channel conversation (or web chat) to agent state.
 */
export interface Conversation {
  id: ConversationId;
  tenantId: TenantId;
  channel: ChannelId;
  channelConversationId: ChannelConversationId;
  title?: string;
  participants: CanonicalUser[];
  status: ConversationStatus;
  agentId?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationParticipant {
  userId: UserId;
  role: 'owner' | 'member' | 'guest';
  joinedAt: Date;
}