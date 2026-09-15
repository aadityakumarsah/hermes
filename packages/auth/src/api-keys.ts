import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthConfig } from '@hermes/config';

export interface ApiKeyMaterial {
  rawKey: string;
  hash: string;
}

export const API_KEY_PREFIX = 'hk_';

export type Role = 'super_admin' | 'admin' | 'member' | 'guest' | 'readonly';

export interface AuthenticatedUser {
  sub: string;
  tenantId?: string;
  role: Role;
  apiKeyId?: string;
}

export const ROLE_HIERARCHY: Record<Role, Role[]> = {
  super_admin: ['admin', 'member', 'guest', 'readonly'],
  admin: ['member', 'guest', 'readonly'],
  member: ['guest', 'readonly'],
  guest: ['readonly'],
  readonly: [],
};

export function hasPermission(userRole: Role, requiredRole: Role): boolean {
  if (userRole === requiredRole) return true;
  return ROLE_HIERARCHY[userRole]?.includes(requiredRole) ?? false;
}

/**
 * Generate an API key. The raw key is shown to the caller exactly once;
 * only the HMAC-SHA256 hash is stored for verification.
 */
export function generateApiKey(config: Pick<AuthConfig, 'apiKeyHmacSecret'>): ApiKeyMaterial {
  const randomPart = randomBytes(32).toString('base64url');
  const rawKey = `${API_KEY_PREFIX}${randomPart}`;
  return { rawKey, hash: hashApiKey(rawKey, config.apiKeyHmacSecret) };
}

export function hashApiKey(rawKey: string, secret: string): string {
  return hmacSha256Hex(rawKey, secret);
}

export function verifyApiKey(rawKey: string, storedHash: string, secret: string): boolean {
  const computed = hmacSha256Hex(rawKey, secret);
  if (computed.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(storedHash, 'hex'));
}

/**
 * Internal reference hash used when a plain SHA-256 is unacceptable (e.g.
 * diagnostics). Verifies a key against config-derived hash without exposing it.
 */
export function referenceHash(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf-8').digest('hex');
}

function hmacSha256Hex(data: string, secret: string): string {
  return createHash('sha256').update(data).update(secret).digest('hex');
}