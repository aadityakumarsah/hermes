import { z } from 'zod';

export const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const serverConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.coerce.number().int().positive().default(3000),
});

export const databaseConfigSchema = z.object({
  url: z.string().min(1),
  maxConnections: z.coerce.number().int().positive().default(10),
  ssl: z.boolean().default(false),
});

export const redisConfigSchema = z.object({
  url: z.string().min(1),
  keyPrefix: z.string().default('hermes:'),
});

export const llmConfigSchema = z.object({
  defaultProvider: z.string().default('openai'),
  defaultModel: z.string().optional(),
  timeoutMs: z.coerce.number().int().positive().default(120_000),
});

export const authConfigSchema = z.object({
  jwtSecret: z.string().min(32),
  jwtExpiresIn: z.string().default('24h'),
  apiKeyHmacSecret: z.string().min(16),
});

export const observabilityConfigSchema = z.object({
  logLevel: logLevelSchema.default('info'),
  otelEndpoint: z.string().url().optional(),
  metricsEnabled: z.boolean().default(true),
});

export const hermesConfigSchema = z.object({
  env: z.enum(['development', 'test', 'production']).default('development'),
  server: serverConfigSchema.default({}),
  database: databaseConfigSchema,
  redis: redisConfigSchema,
  llm: llmConfigSchema.default({}),
  auth: authConfigSchema,
  observability: observabilityConfigSchema.default({}),
  plugins: z
    .object({
      dirs: z.array(z.string()).default([]),
      enabled: z.array(z.string()).default([]),
    })
    .default({}),
});

export type HermesConfig = z.infer<typeof hermesConfigSchema>;
export type ServerConfig = z.infer<typeof serverConfigSchema>;
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;
export type RedisConfig = z.infer<typeof redisConfigSchema>;
export type LLMConfig = z.infer<typeof llmConfigSchema>;
export type AuthConfig = z.infer<typeof authConfigSchema>;
export type ObservabilityConfig = z.infer<typeof observabilityConfigSchema>;

export interface ConfigError extends Error {
  issues: z.ZodIssue[];
  source: 'env' | 'file' | 'defaults';
}