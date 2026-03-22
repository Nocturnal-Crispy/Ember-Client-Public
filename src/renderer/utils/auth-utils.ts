/**
 * Authentication utilities for the Ember renderer.
 * Provides common patterns for fetching and validating authentication data.
 */

/**
 * Fetches and validates authentication data from the main process.
 * Returns null if authentication is missing or invalid.
 */
export async function getValidAuth(): Promise<AuthData | null> {
  const resp = await window.emberAPI.invoke<{
    token: string;
    userId: string;
    deviceId: string;
    hostname: string;
    username: string;
  }>('GetAuth', {});
  const auth: AuthData | null =
    resp.success && resp.data
      ? {
          token: resp.data.token,
          user_id: (resp.data as any).userId ?? (resp.data as any).user_id,
          device_id: (resp.data as any).deviceId ?? (resp.data as any).device_id,
          hostname: resp.data.hostname,
          username: resp.data.username,
        }
      : null;
  if (!auth || !auth.token || !auth.hostname) {
    return null;
  }
  return auth;
}

/**
 * Checks if the current authentication is valid without fetching from IPC.
 * Useful for quick validation when you already have auth data.
 */
export function isValidAuth(auth: unknown): auth is AuthData {
  return !!(
    auth &&
    typeof auth === 'object' &&
    'token' in auth &&
    'hostname' in auth &&
    'user_id' in auth &&
    'device_id' in auth &&
    typeof (auth as AuthData).token === 'string' &&
    typeof (auth as AuthData).hostname === 'string'
  );
}

/**
 * Creates a fetch request with proper authentication headers.
 * Returns null if auth is invalid.
 */
export async function createAuthenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<{ auth: AuthData; fetchOptions: RequestInit } | null> {
  const auth = await getValidAuth();
  if (!auth) {
    return null;
  }

  const fetchOptions: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
      ...options.headers,
    },
  };

  return { auth, fetchOptions };
}
