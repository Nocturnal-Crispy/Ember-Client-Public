// Compatibility shim: reconstruct original variable shapes from the contextBridge API
const ipcRenderer = window.electronAPI.ipc;

const log = window.emberLog.createLogger('Auth');
const _n = window.electronAPI.nacl;
const nacl = {
  randomBytes: _n.randomBytes,
  box: Object.assign((m, n, pk, sk) => _n.box(m, n, pk, sk), {
    open: (b, n, pk, sk) => _n.boxOpen(b, n, pk, sk),
    keyPair: () => _n.boxKeyPair(),
    nonceLength: _n.BOX_NONCE_LENGTH,
  }),
  secretbox: Object.assign((m, n, k) => _n.secretbox(m, n, k), {
    open: (b, n, k) => _n.secretboxOpen(b, n, k),
    nonceLength: _n.SECRETBOX_NONCE_LENGTH,
    keyLength: _n.SECRETBOX_KEY_LENGTH,
  }),
};
const naclUtil = window.electronAPI.naclUtil;
const emberCrypto = window.electronAPI.crypto;

function generateUUID() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

let isLoginMode = true;

let elements = {};

function initializeElements() {
  elements = {
    form: document.getElementById('auth-form'),
    formTitle: document.getElementById('form-title'),
    formSubtitle: document.getElementById('form-subtitle'),
    hostname: document.getElementById('hostname'),
    username: document.getElementById('username'),
    password: document.getElementById('password'),
    confirmPassword: document.getElementById('confirm-password'),
    confirmPasswordGroup: document.getElementById('confirm-password-group'),
    submitBtn: document.getElementById('submit-btn'),
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
    closeBtn: document.getElementById('close-btn')
  };
}

function attachEventListeners() {
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

  if (elements.passwordToggle) {
    elements.passwordToggle.addEventListener('click', () => {
      togglePasswordVisibility(elements.password, elements.passwordToggle);
    });
  }

  if (elements.confirmPasswordToggle) {
    elements.confirmPasswordToggle.addEventListener('click', () => {
      togglePasswordVisibility(elements.confirmPassword, elements.confirmPasswordToggle);
    });
  }

  if (elements.form) {
    elements.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleSubmit();
    });
  }
}

function initialize() {
  log.info('Auth page initializing');
  initializeElements();
  attachEventListeners();

  ipcRenderer.invoke('get-last-hostname').then((lastHostname) => {
    if (lastHostname && elements.hostname) {
      elements.hostname.value = lastHostname;
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

function updateFormMode() {
  if (isLoginMode) {
    elements.formTitle.textContent = 'Welcome to Ember';
    elements.formSubtitle.textContent = 'Login to continue';
    elements.submitBtnText.textContent = 'Login';
    elements.toggleText.textContent = 'Need an account?';
    elements.toggleMode.textContent = 'Register';
    elements.confirmPasswordGroup.style.display = 'none';
    elements.confirmPassword.removeAttribute('required');
    elements.password.setAttribute('autocomplete', 'current-password');
  } else {
    elements.formTitle.textContent = 'Create Account';
    elements.formSubtitle.textContent = 'Join the Ember community';
    elements.submitBtnText.textContent = 'Register';
    elements.toggleText.textContent = 'Already have an account?';
    elements.toggleMode.textContent = 'Login';
    elements.confirmPasswordGroup.style.display = 'block';
    elements.confirmPassword.setAttribute('required', 'required');
    elements.password.setAttribute('autocomplete', 'new-password');
  }
  hideError();
}

function togglePasswordVisibility(input, button) {
  const type = input.type === 'password' ? 'text' : 'password';
  input.type = type;
}

function showError(message) {
  elements.errorBanner.textContent = message;
  elements.errorBanner.classList.remove('hidden');
}

function hideError() {
  elements.errorBanner.classList.add('hidden');
}

function showLoading(message, subtext = '') {
  elements.loadingText.textContent = message;
  elements.loadingSubtext.textContent = subtext;
  elements.loadingOverlay.classList.remove('hidden');
  elements.submitBtn.disabled = true;
}

function hideLoading() {
  elements.loadingOverlay.classList.add('hidden');
  elements.submitBtn.disabled = false;
}

function validateForm() {
  hideError();
  log.debug('Validating auth form', { mode: isLoginMode ? 'login' : 'register' });

  const hostname = elements.hostname.value.trim();
  const username = elements.username.value.trim();
  const password = elements.password.value;
  const confirmPassword = elements.confirmPassword.value;

  if (!hostname) {
    log.warn('Validation failed: hostname missing');
    showError('Server hostname is required');
    return false;
  }

  if (!hostname.startsWith('http://') && !hostname.startsWith('https://')) {
    log.warn('Validation failed: invalid hostname scheme');
    showError('Hostname must start with http:// or https://');
    return false;
  }

  if (!username) {
    log.warn('Validation failed: username missing');
    showError('Username is required');
    return false;
  }

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

  if (!password) {
    log.warn('Validation failed: password missing');
    showError('Password is required');
    return false;
  }

  if (password.length < 8) {
    log.warn('Validation failed: password too short');
    showError('Password must be at least 8 characters');
    return false;
  }

  if (!isLoginMode && password !== confirmPassword) {
    log.warn('Validation failed: passwords do not match');
    showError('Passwords do not match');
    return false;
  }

  log.debug('Form validation passed');
  return true;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectWithRetry(url, options, maxRetries = 3) {
  log.debug('connectWithRetry initiated', { max_retries: maxRetries });
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log.debug('Connection attempt', { attempt, max_retries: maxRetries });
      showLoading('Connecting to server...', `Attempt ${attempt} of ${maxRetries}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        log.debug('Server responded OK', { status: response.status, attempt });
        return response;
      }

      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error || `Server returned status ${response.status}`;
      log.warn('Server returned non-OK response', { status: response.status, attempt });

      if (response.status === 401 || response.status === 409 || response.status === 400) {
        const error = new Error(errorMessage);
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
      if (error.name === 'AbortError') {
        log.warn('Connection attempt timed out', { attempt });
        if (attempt < maxRetries) {
          await sleep(1000 * attempt);
          continue;
        }
        throw new Error('Connection timeout. Server unreachable after 3 attempts.');
      }

      if (error.statusCode === 401) {
        log.warn('Authentication rejected by server');
        throw new Error('Invalid username or password');
      }

      if (error.statusCode === 409 || error.statusCode === 400) {
        log.warn('Request rejected by server', { status: error.statusCode });
        throw error;
      }

      if (attempt < maxRetries) {
        log.warn('Connection error, retrying', { attempt, error: String(error) });
        await sleep(1000 * attempt);
      } else {
        log.error('All connection attempts exhausted');
        throw new Error('Server unreachable. Please check the hostname and try again.');
      }
    }
  }
}

function generateDeviceIdentity() {
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

async function register(hostname, username, password, deviceId, publicKey, encryptedDeviceKey, salt) {
  const url = `${hostname}/api/v1/register`;
  const body = {
    username,
    password,
    device_id: deviceId,
    public_key: publicKey,
    encrypted_device_key: encryptedDeviceKey,
    salt: salt
  };

  const response = await connectWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return await response.json();
}

async function login(hostname, username, password, deviceId) {
  const url = `${hostname}/api/v1/login`;
  const body = {
    username,
    password,
    device_id: deviceId
  };

  const response = await connectWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return await response.json();
}

function showRecoveryCodeModal(recoveryCode) {
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

async function handleSubmit() {
  if (!validateForm()) {
    return;
  }

  const hostname = elements.hostname.value.trim();
  const username = elements.username.value.trim();
  const password = elements.password.value;

  log.info('Auth form submitted', { mode: isLoginMode ? 'login' : 'register', username });

  try {
    log.debug('Loading device identity');
    let deviceIdentity = await ipcRenderer.invoke('get-device-identity');

    if (!deviceIdentity) {
      log.info('No device identity found, generating new one');
      deviceIdentity = generateDeviceIdentity();
      await ipcRenderer.invoke('save-device-identity', deviceIdentity);
      log.info('New device identity saved', { device_id: deviceIdentity.device_id });
    } else {
      log.debug('Existing device identity loaded', { device_id: deviceIdentity.device_id });
    }

    let authData;

    if (isLoginMode) {
      log.info('Initiating login request', { username });
      authData = await login(hostname, username, password, deviceIdentity.device_id);
      log.info('Login successful', { user_id: authData.user_id, username: authData.username });
    } else {
      log.info('Initiating registration request', { username });
      const recoveryCode = emberCrypto.generateRecoveryCode();
      log.debug('Recovery code generated for new account');
      const privateKeyBytes = naclUtil.decodeBase64(deviceIdentity.private_key);
      const recoveryData = await emberCrypto.encryptPrivateKeyWithRecoveryCode(privateKeyBytes, recoveryCode);
      log.debug('Private key encrypted with recovery code');
      authData = await register(
        hostname,
        username,
        password,
        deviceIdentity.device_id,
        deviceIdentity.public_key,
        recoveryData.encrypted,
        recoveryData.salt
      );
      log.info('Registration successful', { user_id: authData.user_id, username: authData.username });
      authData._recoveryCode = recoveryCode;
    }

    log.debug('Saving auth data to store');
    await ipcRenderer.invoke('save-auth', {
      token: authData.token,
      user_id: authData.user_id,
      device_id: authData.device_id,
      hostname: hostname,
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
    log.error('Authentication failed', { error: error.message });
    console.error('Authentication error:', error);
    showError(error.message || 'An unexpected error occurred');
  }
}
