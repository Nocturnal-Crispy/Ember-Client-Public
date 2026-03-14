/**
 * Token refresh service — calls POST /api/v1/refresh to obtain a new JWT.
 */

export interface RefreshTokenResponse {
  readonly token: string;
  readonly user_id: string;
  readonly device_id: string;
  readonly username: string;
}

/**
 * Exchanges a valid (non-expired) token for a fresh one.
 * Throws an Error if the server rejects the request or is unreachable.
 */
export async function refreshToken(
  hostname: string,
  currentToken: string
): Promise<RefreshTokenResponse> {
  const response = await fetch(`${hostname}/api/v1/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${currentToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Token refresh failed with status ${response.status}`);
  }

  return response.json() as Promise<RefreshTokenResponse>;
}
