import { pino, type Logger as PinoLogger, type LoggerOptions } from 'pino';
import type { LogContext, Logger } from '@hermes/core';

export interface LoggerConfig {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
  prettyPrint: boolean;
  base?: Record<string, unknown>;
}

export function createLogger(config: Partial<LoggerConfig> = {}): Logger {
  const options: LoggerOptions = {
    level: config.level ?? defaultLogLevel(),
    base: config.base ?? { service: 'hermes' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (config.prettyPrint ?? process.env.NODE_ENV !== 'production') {
    // pino-pretty via transport is optional; fall back to defaults when missing.
    try {
      options.transport = { target: 'pino-pretty', options: { colorize: true } };
    } catch {
      /* pretty transport unavailable */
    }
  }

  const logger: PinoLogger = pino(options);
  return toLogger(logger);
}

export function toLogger(logger: PinoLogger): Logger {
  return {
    trace: (msg, ctx) => logger.trace(ctx ?? {}, msg),
    debug: (msg, ctx) => logger.debug(ctx ?? {}, msg),
    info: (msg, ctx) => logger.info(ctx ?? {}, msg),
    warn: (msg, ctx) => logger.warn(ctx ?? {}, msg),
    error: (msg, ctx) => logger.error(ctx ?? {}, msg),
    child: (bindings: LogContext) => toLogger(logger.child(bindings)),
  };
}

function defaultLogLevel(): LoggerConfig['level'] {
  const fromEnv = process.env.LOG_LEVEL as LoggerConfig['level'] | undefined;
  if (fromEnv && ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'].includes(fromEnv)) {
    return fromEnv;
  }
  return 'info';
}