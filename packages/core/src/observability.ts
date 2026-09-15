export interface LogContext {
  [key: string]: unknown;
  tenantId?: string;
  userId?: string;
  conversationId?: string;
  sessionId?: string;
  correlationId?: string;
}

export interface Logger {
  trace(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

export interface Tracer {
  startSpan(name: string, opts?: { attributes?: Record<string, unknown> }): TracingSpan;
}

export interface TracingSpan {
  setAttribute(key: string, value: unknown): void;
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  end(status?: 'ok' | 'error' | 'unset'): void;
}

export interface Metrics {
  increment(name: string, value?: number, attributes?: Record<string, string>): void;
  gauge(name: string, value: number, attributes?: Record<string, string>): void;
  histogram(name: string, value: number, attributes?: Record<string, string>): void;
  observeDuration(name: string, fn: () => Promise<void>, attributes?: Record<string, string>): Promise<void>;
}