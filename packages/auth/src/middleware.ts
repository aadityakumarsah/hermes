import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { toAuthenticatedUser, type TokenService } from './jwt.js';
import type { ApiKeyVerifier } from './verifier.js';

export interface AuthContext {
  user?: ReturnType<typeof toAuthenticatedUser>;
  apiKeyHash?: string;
}

export interface AuthDependencies {
  tokenService: TokenService;
  apiKeyVerifier?: ApiKeyVerifier;
}

export const AUTH_CONTEXT_KEY = 'hermes.auth';

/**
 * Hono middleware that authenticates Bearer tokens (JWT or API key from an
 * API-key store). Sets `AuthContext` on the request when valid; anonymous
 * requests pass through with `user` unset.
 */
export function authMiddleware(deps: AuthDependencies) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const header = c.req.header('authorization');
    let auth: AuthContext = {};
    if (header?.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length).trim();
      try {
        const claims = await deps.tokenService.verifyToken(token);
        auth = { user: toAuthenticatedUser(claims) };
      } catch {
        // Attempt API key verification against the configured key store
        if (deps.apiKeyVerifier) {
          const apiKey = await deps.apiKeyVerifier.verify(token);
          if (apiKey) {
            auth = { user: apiKey.user, apiKeyHash: apiKey.hash };
          }
        }
      }
    }
    c.set(AUTH_CONTEXT_KEY, auth);
    await next();
  };
}

/** Require an authenticated principal or raise 401. */
export function requireAuth(c: Context): AuthContext {
  const auth = c.get(AUTH_CONTEXT_KEY) as AuthContext | undefined;
  if (!auth?.user) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  return auth;
}

/** Require a role at or above `requiredRole` or raise 403. */
export function requireRole(requiredRole: 'admin' | 'member' | 'guest' | 'readonly') {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = requireAuth(c);
    if (auth.user!.role !== 'super_admin' && auth.user!.role !== requiredRole) {
      throw new HTTPException(403, { message: `Requires role: ${requiredRole}` });
    }
    await next();
  };
}