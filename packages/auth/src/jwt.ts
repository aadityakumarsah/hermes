import { SignJWT, jwtVerify } from 'jose';
import type { AuthConfig } from '@hermes/config';
import type { AuthenticatedUser, Role } from './api-keys.js';

export interface JwtClaims {
  sub: string;
  tenantId?: string;
  role: Role;
  apiKeyId?: string;
  [key: string]: unknown;
}

export interface TokenService {
  issueToken(user: JwtClaims): Promise<string>;
  verifyToken(token: string): Promise<JwtClaims>;
}

export class JoseTokenService implements TokenService {
  private readonly secret: Uint8Array;
  private readonly authConfig: AuthConfig;

  constructor(authConfig: AuthConfig) {
    this.authConfig = authConfig;
    this.secret = new TextEncoder().encode(authConfig.jwtSecret);
  }

  async issueToken(user: JwtClaims): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ ...user })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setIssuer('hermes')
      .setAudience('hermes-api')
      .setExpirationTime(this.authConfig.jwtExpiresIn)
      .sign(this.secret);
  }

  async verifyToken(token: string): Promise<JwtClaims> {
    const { payload } = await jwtVerify(token, this.secret, {
      issuer: 'hermes',
      audience: 'hermes-api',
      algorithms: ['HS256'],
    });
    return payload as unknown as JwtClaims;
  }
}

export function toAuthenticatedUser(claims: JwtClaims): AuthenticatedUser {
  return {
    sub: claims.sub,
    tenantId: claims.tenantId as AuthenticatedUser['tenantId'],
    role: claims.role,
    apiKeyId: claims.apiKeyId,
  };
}