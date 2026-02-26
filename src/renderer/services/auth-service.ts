/**
 * Auth service — TypeScript conversion of public/auth.js.
 * Handles login/signup/recovery flows on the auth page.
 */
(function (): void {
// Compatibility shim: reconstruct original variable shapes from the contextBridge API
const ipcRenderer = window.electronAPI.ipc;
const log = window.emberLog.createLogger('Auth');
const _n = window.electronAPI.nacl;
const nacl = {
  randomBytes: (n: number) => _n.randomBytes(n),
  box: Object.assign(
    (m: Uint8Array, n: Uint8Array, pk: Uint8Array, sk: Uint8Array) => _n.box(m, n, pk, sk),
    {
      open: (b: Uint8Array, n: Uint8Array, pk: Uint8Array, sk: Uint8Array) => _n.boxOpen(b, n, pk, sk),
      keyPair: () => _n.boxKeyPair(),
      nonceLength: _n.BOX_NONCE_LENGTH,
    }
  ),
  secretbox: Object.assign(
    (m: Uint8Array, n: Uint8Array, k: Uint8Array) => _n.secretbox(m, n, k),
    {
      open: (b: Uint8Array, n: Uint8Array, k: Uint8Array) => _n.secretboxOpen(b, n, k),
      nonceLength: _n.SECRETBOX_NONCE_LENGTH,
      keyLength: _n.SECRETBOX_KEY_LENGTH,
    }
  ),
};
const naclUtil = window.electronAPI.naclUtil;
const emberCrypto = window.electronAPI.crypto;

interface AuthElements {
  form: HTMLFormElement | null;
  formTitle: HTMLElement | null;
  formSubtitle: HTMLElement | null;
  hostname: HTMLInputElement | null;
  username: HTMLInputElement | null;
  password: HTMLInputElement | null;
  confirmPassword: HTMLInputElement | null;
  confirmPasswordGroup: HTMLElement | null;
  submitBtn: HTMLButtonElement | null;
  submitBtnText: HTMLElement | null;
  toggleMode: HTMLElement | null;
  toggleText: HTMLElement | null;
  errorBanner: HTMLElement | null;
  loadingOverlay: HTMLElement | null;
  loadingText: HTMLElement | null;
  loadingSubtext: HTMLElement | null;
  passwordToggle: HTMLElement | null;
  confirmPasswordToggle: HTMLElement | null;
  minimizeBtn: HTMLElement | null;
  maximizeBtn: HTMLElement | null;
  closeBtn: HTMLElement | null;
}

function generateUUID(): string {
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => {
    const n = parseInt(c, 10);
    return (n ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (n / 4)))).toString(16);
  });
}

let isLoginMode = true;
let elements: AuthElements = {
  form: null, formTitle: null, formSubtitle: null, hostname: null, username: null,
  password: null, confirmPassword: null, confirmPasswordGroup: null, submitBtn: null,
  submitBtnText: null, toggleMode: null, toggleText: null, errorBanner: null,
  loadingOverlay: null, loadingText: null, loadingSubtext: null, passwordToggle: null,
  confirmPasswordToggle: null, minimizeBtn: null, maximizeBtn: null, closeBtn: null,
};

function initializeElements(): void {
  elements = {
    form: document.getElementById('auth-form') as HTMLFormElement | null,
    formTitle: document.getElementById('form-title'),
    formSubtitle: document.getElementById('form-subtitle'),
    hostname: document.getElementById('hostname') as HTMLInputElement | null,
    username: document.getElementById('username') as HTMLInputElement | null,
    password: document.getElementById('password') as HTMLInputElement | null,
    confirmPassword: document.getElementById('confirm-password') as HTMLInputElement | null,
    confirmPasswordGroup: document.getElementById('confirm-password-group'),
    submitBtn: document.getElementById('submit-btn') as HTMLButtonElement | null,
    submitBtnText: document.getElementById('submit-btn-text'),
    toggleMode: document.getElementById('toggle-mode'),
    toggleText: document.getElementById('toggle-text'),
    errorBanner: document.getElementById('error-banner'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-text'),
    loadingSubtext: document.getElementById('loading-subtext'),
    passwordToggle: document.getElementById('password-toggle'),
    confirmPasswordToggle: document.getElementById('confirm-password-toggle'),
    minimizeBtn: document.getElementById('minimize-btn'),
    maximizeBtn: document.getElementById('maximize-btn'),
    closeBtn: document.getElementById('close-btn'),
  };
}

function attachEventListeners(): void {
  if (elements.minimizeBtn) {
    log.debug('Minimize button found, attaching listener');
    elements.minimizeBtn.addEventListener('click', () => {
      log.debug('Window minimize clicked');
      ipcRenderer.send('window-minimize');
    });
  } else {
    log.error('Minimize button NOT found in DOM');
  }

  if (elements.maximizeBtn) {
    log.debug('Maximize button found, attaching listener');
    elements.maximizeBtn.addEventListener('click', () => {
      log.debug('Window maximize clicked');
      ipcRenderer.send('window-maximize');
    });
  } else {
    log.error('Maximize button NOT found in DOM');
  }

  if (elements.closeBtn) {
    log.debug('Close button found, attaching listener');
    elements.closeBtn.addEventListener('click', () => {
      log.debug('Window close clicked');
      ipcRenderer.send('window-close');
    });
  } else {
    log.error('Close button NOT found in DOM');
  }

  if (elements.toggleMode) {
    elements.toggleMode.addEventListener('click', () => {
      isLoginMode = !isLoginMode;
      log.debug('Form mode toggled', { mode: isLoginMode ? 'login' : 'register' });
      updateFormMode();
    });
  }

  if (elements.passwordToggle && elements.password) {
    elements.passwordToggle.addEventListener('click', () => {
      togglePasswordVisibility(elements.password!, elements.passwordToggle!);
    });
  }

  if (elements.confirmPasswordToggle && elements.confirmPassword) {
    elements.confirmPasswordToggle.addEventListener('click', () => {
      togglePasswordVisibility(elements.confirmPassword!, elements.confirmPasswordToggle!);
    });
  }

  if (elements.form) {
    elements.form.addEventListener('submit', async (e: Event) => {
      e.preventDefault();
      await handleSubmit();
    });
  }
}

function initialize(): void {
  log.info('Auth page initializing');
  initializeElements();
  attachEventListeners();

  ipcRenderer.invoke('get-last-hostname').then((lastHostname) => {
    if (lastHostname && elements.hostname) {
      elements.hostname.value = String(lastHostname);
      log.debug('Last hostname pre-filled');
    }
  });

  log.info('Auth page initialized');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

function updateFormMode(): void {
  if (isLoginMode) {
    if (elements.formTitle) elements.formTitle.textContent = 'Welcome to Ember';
    if (elements.formSubtitle) elements.formSubtitle.textContent = 'Login to continue';
    if (elements.submitBtnText) elements.submitBtnText.textContent = 'Login';
    if (elements.toggleText) elements.toggleText.textContent = 'Need an account?';
    if (elements.toggleMode) elements.toggleMode.textContent = 'Register';
    if (elements.confirmPasswordGroup) elements.confirmPasswordGroup.style.display = 'none';
    if (elements.confirmPassword) elements.confirmPassword.removeAttribute('required');
    if (elements.password) elements.password.setAttribute('autocomplete', 'current-password');
  } else {
    if (elements.formTitle) elements.formTitle.textContent = 'Create Account';
    if (elements.formSubtitle) elements.formSubtitle.textContent = 'Join the Ember community';
    if (elements.submitBtnText) elements.submitBtnText.textContent = 'Register';
    if (elements.toggleText) elements.toggleText.textContent = 'Already have an account?';
    if (elements.toggleMode) elements.toggleMode.textContent = 'Login';
    if (elements.confirmPasswordGroup) elements.confirmPasswordGroup.style.display = 'block';
    if (elements.confirmPassword) elements.confirmPassword.setAttribute('required', 'required');
    if (elements.password) elements.password.setAttribute('autocomplete', 'new-password');
  }
  hideError();
}

function togglePasswordVisibility(input: HTMLInputElement, _button: HTMLElement): void {
  input.type = input.type === 'password' ? 'text' : 'password';
}

function showError(message: string): void {
  if (elements.errorBanner) {
    elements.errorBanner.textContent = message;
    elements.errorBanner.classList.remove('hidden');
  }
}

function hideError(): void {
  if (elements.errorBanner) elements.errorBanner.classList.add('hidden');
}

function showLoading(message: string, subtext = ''): void {
  if (elements.loadingText) elements.loadingText.textContent = message;
  if (elements.loadingSubtext) elements.loadingSubtext.textContent = subtext;
  if (elements.loadingOverlay) elements.loadingOverlay.classList.remove('hidden');
  if (elements.submitBtn) elements.submitBtn.disabled = true;
}

function hideLoading(): void {
  if (elements.loadingOverlay) elements.loadingOverlay.classList.add('hidden');
  if (elements.submitBtn) elements.submitBtn.disabled = false;
}

function validateForm(): boolean {
  hideError();
  log.debug('Validating auth form', { mode: isLoginMode ? 'login' : 'register' });

  const hostname = elements.hostname?.value.trim() ?? '';
  const username = elements.username?.value.trim() ?? '';
  const password = elements.password?.value ?? '';
  const confirmPassword = elements.confirmPassword?.value ?? '';

  if (!hostname) { log.warn('Validation failed: hostname missing'); showError('Server hostname is required'); return false; }
  if (!hostname.startsWith('http://') && !hostname.startsWith('https://')) {
    log.warn('Validation failed: invalid hostname scheme');
    showError('Hostname must start with http:// or https://');
    return false;
  }
  if (!username) { log.warn('Validation failed: username missing'); showError('Username is required'); return false; }
  if (username.length < 3 || username.length > 20) {
    log.warn('Validation failed: username length out of range', { length: username.length });
    showError('Username must be 3-20 characters');
    return false;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    log.warn('Validation failed: username contains invalid characters');
    showError('Username can only contain letters, numbers, and underscores');
    return false;
  }
  if (!password) { log.warn('Validation failed: password missing'); showError('Password is required'); return false; }
  if (password.length < 8) { log.warn('Validation failed: password too short'); showError('Password must be at least 8 characters'); return false; }
  if (!isLoginMode && password !== confirmPassword) {
    log.warn('Validation failed: passwords do not match');
    showError('Passwords do not match');
    return false;
  }

  log.debug('Form validation passed');
  return true;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface FetchError extends Error {
  statusCode?: number;
}

async function connectWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  log.debug('connectWithRetry initiated', { max_retries: maxRetries });
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log.debug('Connection attempt', { attempt, max_retries: maxRetries });
      showLoading('Connecting to server...', `Attempt ${attempt} of ${maxRetries}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        log.debug('Server responded OK', { status: response.status, attempt });
        return response;
      }

      const errorData = await response.json().catch(() => ({})) as { error?: string };
      const errorMessage = errorData.error ?? `Server returned status ${response.status}`;
      log.warn('Server returned non-OK response', { status: response.status, attempt });

      if (response.status === 401 || response.status === 409 || response.status === 400) {
        const error: FetchError = new Error(errorMessage);
        error.statusCode = response.status;
        throw error;
      }

      if (attempt < maxRetries) {
        log.debug('Retrying after delay', { attempt, delay_ms: 1000 * attempt });
        await sleep(1000 * attempt);
      } else {
        throw new Error('Connection timeout. Server unreachable after 3 attempts.');
      }
    } catch (error) {
      const err = error as FetchError;
      if (err.name === 'AbortError') {
        log.warn('Connection attempt timed out', { attempt });
        if (attempt < maxRetries) { await sleep(1000 * attempt); continue; }
        throw new Error('Connection timeout. Server unreachable after 3 attempts.');
      }
      if (err.statusCode === 401) { log.warn('Authentication rejected by server'); throw new Error('Invalid username or password'); }
      if (err.statusCode === 409 || err.statusCode === 400) { log.warn('Request rejected by server', { status: err.statusCode }); throw err; }
      if (attempt < maxRetries) {
        log.warn('Connection error, retrying', { attempt, error: String(error) });
        await sleep(1000 * attempt);
      } else {
        log.error('All connection attempts exhausted');
        throw new Error('Server unreachable. Please check the hostname and try again.');
      }
    }
  }
  throw new Error('Connection failed');
}

function generateDeviceIdentity(): DeviceIdentity {
  log.info('Generating new device identity (keypair)');
  const deviceId = generateUUID();
  const keyPair = nacl.box.keyPair();
  log.info('Device identity generated', { device_id: deviceId });
  return {
    device_id: deviceId,
    public_key: naclUtil.encodeBase64(keyPair.publicKey),
    private_key: naclUtil.encodeBase64(keyPair.secretKey)
  };
}

async function register(
  hostname: string, username: string, password: string,
  deviceId: string, publicKey: string, encryptedDeviceKey: string, salt: string
): Promise<AuthResponse> {
  const response = await connectWithRetry(`${hostname}/api/v1/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, device_id: deviceId, public_key: publicKey, encrypted_device_key: encryptedDeviceKey, salt })
  });
  return response.json() as Promise<AuthResponse>;
}

async function login(hostname: string, username: string, password: string, deviceId: string): Promise<AuthResponse> {
  const response = await connectWithRetry(`${hostname}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, device_id: deviceId })
  });
  return response.json() as Promise<AuthResponse>;
}

function showRecoveryCodeModal(recoveryCode: string): void {
  log.info('Showing recovery code modal to user');
  const modal = document.getElementById('recovery-code-modal');
  const display = document.getElementById('recovery-code-display');
  const copyBtn = document.getElementById('recovery-code-copy-btn');
  const continueBtn = document.getElementById('recovery-code-continue-btn');
  if (!modal || !display) return;
  display.textContent = recoveryCode;
  modal.classList.remove('hidden');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(recoveryCode).then(() => {
        log.debug('Recovery code copied to clipboard by user');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
      });
    });
  }
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      log.info('User acknowledged recovery code, proceeding to main app');
      modal.classList.add('hidden');
      ipcRenderer.send('auth-success');
    });
  }
}

async function handleSubmit(): Promise<void> {
  if (!validateForm()) return;

  const hostname = elements.hostname?.value.trim() ?? '';
  const username = elements.username?.value.trim() ?? '';
  const password = elements.password?.value ?? '';

  log.info('Auth form submitted', { mode: isLoginMode ? 'login' : 'register', username });

  try {
    log.debug('Loading device identity');
    let deviceIdentity = await ipcRenderer.invoke('get-device-identity') as DeviceIdentity | null;

    if (!deviceIdentity) {
      log.info('No device identity found, generating new one');
      deviceIdentity = generateDeviceIdentity();
      await ipcRenderer.invoke('save-device-identity', deviceIdentity);
      log.info('New device identity saved', { device_id: deviceIdentity.device_id });
    } else {
      log.debug('Existing device identity loaded', { device_id: deviceIdentity.device_id });
    }

    let authData: AuthResponse;

    if (isLoginMode) {
      log.info('Initiating login request', { username });
      authData = await login(hostname, username, password, deviceIdentity.device_id);
      log.info('Login successful', { user_id: authData.user_id, username: authData.username });
    } else {
      log.info('Initiating registration request', { username });
      const recoveryCode = emberCrypto.generateRecoveryCode();
      log.debug('Recovery code generated for new account');
      const privateKeyBytes = naclUtil.decodeBase64(deviceIdentity.private_key);
      const recoveryData: RecoveryData = await emberCrypto.encryptPrivateKeyWithRecoveryCode(privateKeyBytes, recoveryCode);
      log.debug('Private key encrypted with recovery code');
      authData = await register(hostname, username, password, deviceIdentity.device_id, deviceIdentity.public_key, recoveryData.encrypted, recoveryData.salt);
      log.info('Registration successful', { user_id: authData.user_id, username: authData.username });
      authData._recoveryCode = recoveryCode;
    }

    log.debug('Saving auth data to store');
    await ipcRenderer.invoke('save-auth', {
      token: authData.token,
      user_id: authData.user_id,
      device_id: authData.device_id,
      hostname,
      username: authData.username
    });
    log.info('Auth data saved', { username: authData.username, user_id: authData.user_id });

    hideLoading();

    if (authData._recoveryCode) {
      showRecoveryCodeModal(authData._recoveryCode);
    } else {
      log.info('Authentication complete, transitioning to main app');
      ipcRenderer.send('auth-success');
    }
  } catch (error) {
    hideLoading();
    const err = error as Error;
    log.error('Authentication failed', { error: err.message });
    console.error('Authentication error:', error);
    showError(err.message || 'An unexpected error occurred');
  }
}
})();
