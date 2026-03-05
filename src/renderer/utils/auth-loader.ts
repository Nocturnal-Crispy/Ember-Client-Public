/**
 * Auth utilities loader - exposes auth utility functions to the global window object.
 * This file should be loaded before other modules that depend on auth utilities.
 */

// Directly define the auth utilities here to avoid CommonJS require issues in browser
/**
 * Fetches and validates authentication data from the main process.
 * Returns null if authentication is missing or invalid.
 */
async function getValidAuth(): Promise<AuthData | null> {
  const auth = (await window.electronAPI.ipc.invoke("get-auth")) as AuthData | null;
  if (!auth || !auth.token || !auth.hostname) {
    return null;
  }
  return auth;
}

/**
 * Checks if the current authentication is valid without fetching from IPC.
 * Useful for quick validation when you already have auth data.
 */
function isValidAuth(auth: unknown): auth is AuthData {
  return !!(
    auth &&
    typeof auth === "object" &&
    "token" in auth &&
    "hostname" in auth &&
    "user_id" in auth &&
    "device_id" in auth &&
    typeof (auth as AuthData).token === "string" &&
    typeof (auth as AuthData).hostname === "string"
  );
}

/**
 * Creates a fetch request with proper authentication headers.
 * Returns null if auth is invalid.
 */
async function createAuthenticatedFetch(
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
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
      ...options.headers,
    },
  };

  return { auth, fetchOptions };
}

// Expose auth utilities globally
window.getValidAuth = getValidAuth;
window.isValidAuth = isValidAuth;
window.createAuthenticatedFetch = createAuthenticatedFetch;
