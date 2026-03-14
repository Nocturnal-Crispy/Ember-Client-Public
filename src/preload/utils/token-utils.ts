/**
 * Token utility functions for JWT expiry detection.
 * Decodes JWT payloads without signature verification (client-side only).
 */

/**
 * Decodes the payload of a JWT and returns the `exp` claim in Unix seconds.
 * Returns null if the token is malformed or `exp` is absent.
 */
export function getTokenExpiry(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // base64url → base64 → JSON
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    if (typeof parsed['exp'] !== 'number') return null;
    return parsed['exp'];
  } catch {
    return null;
  }
}

/**
 * Returns true when the token is already expired or will expire within
 * `thresholdSeconds` from now. Returns true for malformed tokens.
 */
export function isTokenExpiringSoon(token: string, thresholdSeconds: number): boolean {
  const exp = getTokenExpiry(token);
  if (exp === null) return true;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return exp - nowSeconds <= thresholdSeconds;
}
