export type HermesEventType =
  | 'message.received'
  | 'message.completed'
  | 'conversation.created'
  | 'session.started'
  | 'session.ended'
  | 'agent.turn.start'
  | 'agent.turn.end'
  | 'tool.started'
  | 'tool.completed'
  | 'job.queued'
  | 'job.succeeded'
  | 'job.failed'
  | 'memory.stored'
  | 'memory.recalled'
  | 'workflow.started'
  | 'workflow.completed';

export interface HermesEventBase<TType extends HermesEventType> {
  type: TType;
  id: string;
  tenantId?: string;
  correlationId?: string;
  timestamp: Date;
  data: unknown;
}

export type HermesEvent = {
  [T in HermesEventType]: HermesEventBase<T> & { data: EventDataMap[T] };
}[HermesEventType];

export interface EventDataMap {
  'message.received': { messageId: string; conversationId: string; channel: string };
  'message.completed': { messageId: string; conversationId: string; channel: string };
  'conversation.created': { conversationId: string; tenantId: string };
  'session.started': { sessionId: string; conversationId: string };
  'session.ended': { sessionId: string; conversationId: string };
  'agent.turn.start': { sessionId: string; turnId: string };
  'agent.turn.end': { sessionId: string; turnId: string; stopReason: string };
  'tool.started': { toolName: string; invocationId: string };
  'tool.completed': { toolName: string; invocationId: string; ok: boolean };
  'job.queued': { jobId: string; type: string };
  'job.succeeded': { jobId: string; type: string };
  'job.failed': { jobId: string; type: string; error?: string };
  'memory.stored': { memoryId: string; type: string };
  'memory.recalled': { count: number };
  'workflow.started': { workflowId: string };
  'workflow.completed': { workflowId: string; ok: boolean };
}

export interface EventPublisher {
  publish(event: HermesEvent): Promise<void>;
  subscribe(type: HermesEventType, handler: (event: HermesEvent) => void): () => void;
}