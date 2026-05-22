import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthError, createAuthToken, getUserIdFromRequest } from './auth';

test('createAuthToken signs a token accepted by getUserIdFromRequest', () => {
  process.env['AUTH_TOKEN_SECRET'] = 'test-secret';
  const token = createAuthToken('user-123', new Date('2026-05-19T00:00:00.000Z'));
  const request = new Request('http://localhost/api/v1/user/profile', {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(getUserIdFromRequest(request), 'user-123');
});

test('getUserIdFromRequest rejects tampered signed tokens', () => {
  process.env['AUTH_TOKEN_SECRET'] = 'test-secret';
  const token = createAuthToken('user-123');
  const tampered = `${token.slice(0, -2)}xx`;
  const request = new Request('http://localhost/api/v1/user/profile', {
    headers: { Authorization: `Bearer ${tampered}` },
  });

  assert.throws(() => getUserIdFromRequest(request), AuthError);
});

test('getUserIdFromRequest supports legacy dev tokens outside production', () => {
  const request = new Request('http://localhost/api/v1/user/profile', {
    headers: { Authorization: 'Bearer token-dev-user' },
  });

  assert.equal(getUserIdFromRequest(request), 'dev-user');
});
