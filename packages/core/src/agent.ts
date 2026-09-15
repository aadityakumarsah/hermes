export type ModelProvider = 'openai' | 'anthropic' | 'google' | 'local' | string;

export interface ModelRef {
  provider: ModelProvider;
  model: string;
}

export interface AgentTurnRequest {
  sessionId: string;
  conversationId: string;
  userId?: string;
  tenantId?: string;
  message: string;
  attachments?: unknown[];
  signal?: AbortSignal;
}

export interface AgentTurnResponse {
  text?: string;
  stopReason: 'stop' | 'toolUse' | 'length' | 'error' | 'aborted';
  toolCalls: TurnToolCall[];
  usage?: TokenUsage;
}

export interface TurnToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}