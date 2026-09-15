export type ToolId = Brand<'ToolId'>;

type Brand<T extends string> = string & { __brand?: T };

export type ToolCategory = 'filesystem' | 'shell' | 'web' | 'messaging' | 'scheduling' | 'memory' | 'integration';

/**
 * JSON Schema parameter definition for a tool.
 */
export type ToolParameters = Record<string, unknown>;

export type ToolExecutionMode = 'sequential' | 'parallel';

export interface ToolResult {
  ok: boolean;
  output?: string;
  structured?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * A callable tool exposed to the agent loop.
 */
export interface AgentTool<TParams = unknown, TResult extends ToolResult = ToolResult> {
  readonly name: string;
  readonly description: string;
  readonly category: ToolCategory;
  readonly parameters: ToolParameters;
  readonly executionMode?: ToolExecutionMode;
  /** If true the parameter schema participates in the model-facing context. */
  readonly includeInContext?: 'on' | 'off' | 'only';
  execute(args: TParams, context: ToolExecutionContext): Promise<TResult>;
}

export interface ToolExecutionContext {
  tenantId?: string;
  userId?: string;
  conversationId?: string;
  sessionId?: string;
  signal?: AbortSignal;
  logger?: import('./observability.js').Logger;
}