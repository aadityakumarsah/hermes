import type { ConversationId, SessionId, TenantId } from './id.js';

export enum SessionStatus {
  Active = 'active',
  Idle = 'idle',
  Compacting = 'compacting',
  Expired = 'expired',
}

export interface SessionState {
  id: SessionId;
  tenantId: TenantId;
  conversationId: ConversationId;
  agentId: string;
  status: SessionStatus;
  modelRefs: string[];
  tokenUsage: number;
  contextWindow?: unknown;
  metadata: Record<string, unknown>;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface SessionSummary {
  id: SessionId;
  conversationId: ConversationId;
  title?: string;
  messageCount: number;
  lastMessageAt?: Date;
  createdAt: Date;
}