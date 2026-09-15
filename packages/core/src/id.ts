export type Brand<T, B extends string> = T & { readonly __brand: B };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type ConversationId = Brand<string, 'ConversationId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type MemoryId = Brand<string, 'MemoryId'>;
export type JobId = Brand<string, 'JobId'>;
export type WorkflowId = Brand<string, 'WorkflowId'>;
export type ChannelConversationId = Brand<string, 'ChannelConversationId'>;

export type EntityId =
  | TenantId
  | UserId
  | ConversationId
  | SessionId
  | MessageId
  | MemoryId
  | JobId
  | WorkflowId;