import { z } from 'zod';
import { hermesConfigSchema, type ConfigError, type HermesConfig } from './schema.js';

export const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'API_KEY_HMAC_SECRET',
] as const;

export type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

export const ENV_OVERRIDES: Record<string, string> = {
  HERMES_ENV: 'env',
  HOST: 'server.host',
  PORT: 'server.port',
  DATABASE_URL: 'database.url',
  REDIS_URL: 'redis.url',
  LLM_DEFAULT_PROVIDER: 'llm.defaultProvider',
  LLM_DEFAULT_MODEL: 'llm.defaultModel',
  JWT_SECRET: 'auth.jwtSecret',
  JWT_EXPIRES_IN: 'auth.jwtExpiresIn',
  API_KEY_HMAC_SECRET: 'auth.apiKeyHmacSecret',
  LOG_LEVEL: 'observability.logLevel',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'observability.otelEndpoint',
};

export function missingRequiredEnvVars(env: NodeJS.ProcessEnv = process.env): RequiredEnvVar[] {
  return REQUIRED_ENV_VARS.filter((name) => !env[name]);
}

/** Project env + defaults shaped as a partial config object (JSON pointer keys). */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<HermesConfig> {
  const partial: Record<string, unknown> = {};
  for (const [envKey, configPath] of Object.entries(ENV_OVERRIDES)) {
    const value = env[envKey];
    if (value !== undefined && value !== '') {
      partial[configPath] = value;
    }
  }
  return partial as Partial<HermesConfig>;
}

function setDeep(target: Record<string, unknown>, path: string[], value: unknown): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  const next = (target[head] as Record<string, unknown>) ?? {};
  target[head] = next;
  setDeep(next, rest, value);
}

/**
 * Load config from a JSON file with env overrides and defaults applied.
 * Fails fast on missing required values or invalid types.
 */
export function loadConfig(source: Partial<HermesConfig> = {}, env: NodeJS.ProcessEnv = process.env): HermesConfig {
  const merged: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(configFromEnv(env))) {
    setDeep(merged, path.split('.'), value);
  }
  if (source && Object.keys(source).length > 0) {
    for (const [key, value] of Object.entries(source)) {
      setDeep(merged, [key], value);
    }
  }

  const result = hermesConfigSchema.safeParse(merged);
  if (!result.success) {
    throw createConfigError(result.error, 'env');
  }

  const config = result.data;
  const missing = missingRequiredEnvVars(env);
  if (missing.length > 0) {
    const err = new Error(`Missing required environment variables: ${missing.join(', ')}`) as Error & ConfigError;
    err.name = 'ConfigError';
    err.issues = missing.map(
      (varName): z.ZodIssue => ({
        code: 'custom',
        path: [varName],
        message: `Missing required environment variable: ${varName}`,
      }),
    );
    err.source = 'env';
    throw err;
  }
  return config;
}

function createConfigError(error: z.ZodError, source: 'env' | 'file'): ConfigError {
  const err = new Error(`Invalid configuration: ${error.issues.map((i) => i.path.join('.')).join(', ')}`) as Error &
    ConfigError;
  err.name = 'ConfigError';
  err.issues = error.issues;
  err.source = source;
  return err;
}