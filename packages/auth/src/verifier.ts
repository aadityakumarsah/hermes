import type { AuthenticatedUser } from './api-keys.js';

export interface ApiKeyRecord {
  hash: string;
  user: AuthenticatedUser;
}

/**
 * Resolves an API key (by bearer token) to a stored record. Concrete
 * implementations query the tenant's API-key table.
 */
export interface ApiKeyVerifier {
  verify(token: string): Promise<ApiKeyRecord | null>;
}