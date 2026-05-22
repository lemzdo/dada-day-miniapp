import { createHmac, timingSafeEqual } from 'crypto';

const DEV_USER_ID = 'mock-user-001';
const LEGACY_TOKEN_PREFIX = 'token-';
const SIGNED_TOKEN_PREFIX = 'd1d.';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

interface AuthTokenPayload {
  sub: string;
  iat: number;
  exp: number;
  v: 1;
}

export class AuthError extends Error {
  constructor(message = 'unauthorized') {
    super(message);
    this.name = 'AuthError';
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

export function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization') ?? '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

export function createAuthToken(userId: string, now = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload: AuthTokenPayload = {
    sub: userId,
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
    v: 1,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${SIGNED_TOKEN_PREFIX}${encodedPayload}.${signature}`;
}

export function getUserIdFromRequest(request: Request): string {
  const token = getBearerToken(request);
  if (!token) {
    if (isDevAuthEnabled()) return DEV_USER_ID;
    throw new AuthError('missing token');
  }

  const verifiedUserId = verifyAuthToken(token);
  if (verifiedUserId) return verifiedUserId;

  if (isDevAuthEnabled() && token.startsWith(LEGACY_TOKEN_PREFIX)) {
    return token.slice(LEGACY_TOKEN_PREFIX.length) || DEV_USER_ID;
  }

  throw new AuthError('invalid token');
}

function verifyAuthToken(token: string): string | null {
  if (!token.startsWith(SIGNED_TOKEN_PREFIX)) return null;

  const unsigned = token.slice(SIGNED_TOKEN_PREFIX.length);
  const [encodedPayload, signature] = unsigned.split('.');
  if (!encodedPayload || !signature) return null;

  const expected = sign(encodedPayload);
  if (!safeEqual(signature, expected)) return null;

  const payload = parsePayload(encodedPayload);
  if (!payload) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return null;

  return payload.sub;
}

function parsePayload(encodedPayload: string): AuthTokenPayload | null {
  try {
    const json = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as Partial<AuthTokenPayload>;
    if (
      payload.v !== 1 ||
      typeof payload.sub !== 'string' ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }
    return payload as AuthTokenPayload;
  } catch {
    return null;
  }
}

function sign(value: string): string {
  return createHmac('sha256', getAuthSecret()).update(value).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function getAuthSecret(): string {
  const secret = process.env['AUTH_TOKEN_SECRET'] ?? process.env['NEXTAUTH_SECRET'];
  if (secret) return secret;
  if (isDevAuthEnabled()) return 'd1d-dev-auth-secret';
  throw new AuthError('auth secret is not configured');
}

function isDevAuthEnabled(): boolean {
  return process.env['NODE_ENV'] !== 'production' || process.env['D1D_ENABLE_DEV_AUTH'] === 'true';
}
