/**
 * TOTP 2FA service — handles setup, verification, and management of
 * two-factor authentication via Google Authenticator / TOTP apps.
 */
(function (): void {
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger('TOTP');

  interface TOTPSetupResponse {
    url: string;
    backupCodes: string[];
  }

  interface TOTPStatusResponse {
    enabled: boolean;
  }

  async function getAuth(): Promise<{ token: string; hostname: string }> {
    const auth = (await ipcRenderer.invoke('get-auth')) as {
      token: string;
      hostname: string;
    } | null;
    if (!auth || !auth.token || !auth.hostname) {
      throw new Error('Not authenticated');
    }
    return auth;
  }

  async function apiCall<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const { token, hostname } = await getAuth();
    const opts: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const resp = await fetch(`${hostname}/api/v1${path}`, opts);
    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || `Request failed: ${resp.status}`);
    }

    return data as T;
  }

  async function setupTOTP(): Promise<TOTPSetupResponse> {
    log.info('Initiating 2FA setup');
    return apiCall<TOTPSetupResponse>('POST', '/2fa/setup');
  }

  async function verifyTOTP(code: string): Promise<void> {
    log.info('Verifying 2FA code');
    await apiCall<{ message: string }>('POST', '/2fa/verify', { code });
    log.info('2FA enabled successfully');
  }

  async function disableTOTP(code: string): Promise<void> {
    log.info('Disabling 2FA');
    await apiCall<{ message: string }>('POST', '/2fa/disable', { code });
    log.info('2FA disabled successfully');
  }

  async function getTOTPStatus(): Promise<boolean> {
    const resp = await apiCall<TOTPStatusResponse>('GET', '/2fa/status');
    return resp.enabled;
  }

  // Export to global scope
  window.totpService = {
    setup: setupTOTP,
    verify: verifyTOTP,
    disable: disableTOTP,
    getStatus: getTOTPStatus,
  };
})();
