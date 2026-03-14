/**
 * Unit tests for token refresh utilities and refreshToken service.
 *
 * Tests cover:
 *   - getTokenExpiry: decodes JWT exp claim without verification
 *   - isTokenExpiringSoon: detects tokens within the refresh threshold
 *   - refreshToken: calls POST /api/v1/refresh and returns new AuthResponse
 */

// @jest-environment node

import { getTokenExpiry, isTokenExpiringSoon } from '../../../src/preload/utils/token-utils';
import { refreshToken } from '../../../src/preload/services/token-refresh-service';

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesignature`;
}

// ─── getTokenExpiry ───────────────────────────────────────────────────────────

describe('getTokenExpiry', () => {
  it('returns the exp timestamp from a valid JWT', () => {
    const expTimestamp = Math.floor(Date.now() / 1000) + 3600;
    const token = buildJwt({ sub: 'user1', exp: expTimestamp });
    expect(getTokenExpiry(token)).toBe(expTimestamp);
  });

  it('returns null for a malformed token', () => {
    expect(getTokenExpiry('not.a.valid')).toBeNull();
  });

  it('returns null when exp claim is missing', () => {
    const token = buildJwt({ sub: 'user1' });
    expect(getTokenExpiry(token)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(getTokenExpiry('')).toBeNull();
  });
});

// ─── isTokenExpiringSoon ──────────────────────────────────────────────────────

describe('isTokenExpiringSoon', () => {
  it('returns true when token expires within the threshold', () => {
    const expTimestamp = Math.floor(Date.now() / 1000) + 1800; // 30 min from now
    const token = buildJwt({ exp: expTimestamp });
    expect(isTokenExpiringSoon(token, 3600)).toBe(true); // 1hr threshold
  });

  it('returns false when token expires well beyond the threshold', () => {
    const expTimestamp = Math.floor(Date.now() / 1000) + 7200; // 2hrs from now
    const token = buildJwt({ exp: expTimestamp });
    expect(isTokenExpiringSoon(token, 3600)).toBe(false); // 1hr threshold
  });

  it('returns true for an already expired token', () => {
    const expTimestamp = Math.floor(Date.now() / 1000) - 60; // expired 1min ago
    const token = buildJwt({ exp: expTimestamp });
    expect(isTokenExpiringSoon(token, 3600)).toBe(true);
  });

  it('returns true for a malformed token', () => {
    expect(isTokenExpiringSoon('bad.token', 3600)).toBe(true);
  });
});

// ─── refreshToken ─────────────────────────────────────────────────────────────

describe('refreshToken', () => {
  const mockFetch = jest.fn();

  beforeAll(() => {
    (global as any).fetch = mockFetch;
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  it('calls POST /api/v1/refresh with Bearer token and returns new token response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: 'new-token-xyz',
        user_id: 'user1',
        device_id: 'device1',
        username: 'testuser',
      }),
    });

    const result = await refreshToken('http://localhost:8085', 'old-token-abc');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8085/api/v1/refresh');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer old-token-abc');
    expect(result.token).toBe('new-token-xyz');
    expect(result.user_id).toBe('user1');
  });

  it('throws when the server returns 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid token' }),
    });

    await expect(refreshToken('http://localhost:8085', 'expired-token')).rejects.toThrow();
  });

  it('throws when the server is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(refreshToken('http://localhost:8085', 'any-token')).rejects.toThrow('Network error');
  });
});
