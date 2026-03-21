const MAX_RETRIES = 3;
const TIMEOUT_MS = 10000;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(
  hostname: string,
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const normalizedHostname = hostname.replace(/\/+$/, '');
  const url = `${normalizedHostname}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        return response.json() as Promise<T>;
      }

      const errorData = await response.json().catch(() => ({})) as { error?: string };
      const message = errorData.error ?? `Server returned ${response.status}`;

      // Non-retryable status codes
      if (response.status === 400 || response.status === 401 || response.status === 409) {
        throw new ApiError(message, response.status);
      }

      if (attempt < MAX_RETRIES) {
        await sleep(1000 * attempt);
        continue;
      }
      throw new ApiError(message, response.status);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof ApiError) throw err;

      const error = err as Error;
      if (error.name === 'AbortError') {
        if (attempt < MAX_RETRIES) { await sleep(1000 * attempt); continue; }
        throw new ApiError('Connection timeout. Server unreachable after 3 attempts.', 0);
      }

      if (attempt < MAX_RETRIES) {
        await sleep(1000 * attempt);
        continue;
      }
      throw new ApiError('Server unreachable. Please check the hostname and try again.', 0);
    }
  }

  throw new ApiError('Connection failed', 0);
}
