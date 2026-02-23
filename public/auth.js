// Compatibility shim: reconstruct original variable shapes from the contextBridge API
const ipcRenderer = window.electronAPI.ipc;
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
    console.log('Minimize button found, attaching listener');
    elements.minimizeBtn.addEventListener('click', () => {
      console.log('Minimize button clicked');
      ipcRenderer.send('window-minimize');
    });
  } else {
    console.error('Minimize button NOT found');
  }

  if (elements.maximizeBtn) {
    console.log('Maximize button found, attaching listener');
    elements.maximizeBtn.addEventListener('click', () => {
      console.log('Maximize button clicked');
      ipcRenderer.send('window-maximize');
    });
  } else {
    console.error('Maximize button NOT found');
  }

  if (elements.closeBtn) {
    console.log('Close button found, attaching listener');
    elements.closeBtn.addEventListener('click', () => {
      console.log('Close button clicked');
      ipcRenderer.send('window-close');
    });
  } else {
    console.error('Close button NOT found');
  }

  if (elements.toggleMode) {
    elements.toggleMode.addEventListener('click', () => {
      isLoginMode = !isLoginMode;
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
  initializeElements();
  attachEventListeners();
  
  ipcRenderer.invoke('get-last-hostname').then((lastHostname) => {
    if (lastHostname && elements.hostname) {
      elements.hostname.value = lastHostname;
    }
  });
  
  console.log('Auth page initialized');
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
  
  const hostname = elements.hostname.value.trim();
  const username = elements.username.value.trim();
  const password = elements.password.value;
  const confirmPassword = elements.confirmPassword.value;

  if (!hostname) {
    showError('Server hostname is required');
    return false;
  }

  if (!hostname.startsWith('http://') && !hostname.startsWith('https://')) {
    showError('Hostname must start with http:// or https://');
    return false;
  }

  if (!username) {
    showError('Username is required');
    return false;
  }

  if (username.length < 3 || username.length > 20) {
    showError('Username must be 3-20 characters');
    return false;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showError('Username can only contain letters, numbers, and underscores');
    return false;
  }

  if (!password) {
    showError('Password is required');
    return false;
  }

  if (password.length < 8) {
    showError('Password must be at least 8 characters');
    return false;
  }

  if (!isLoginMode && password !== confirmPassword) {
    showError('Passwords do not match');
    return false;
  }

  return true;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      showLoading('Connecting to server...', `Attempt ${attempt} of ${maxRetries}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        return response;
      }

      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error || `Server returned status ${response.status}`;
      
      if (response.status === 401 || response.status === 409 || response.status === 400) {
        const error = new Error(errorMessage);
        error.statusCode = response.status;
        throw error;
      }

      if (attempt < maxRetries) {
        await sleep(1000 * attempt);
      } else {
        throw new Error('Connection timeout. Server unreachable after 3 attempts.');
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        if (attempt < maxRetries) {
          await sleep(1000 * attempt);
          continue;
        }
        throw new Error('Connection timeout. Server unreachable after 3 attempts.');
      }

      if (error.statusCode === 401) {
        throw new Error('Invalid username or password');
      }

      if (error.statusCode === 409 || error.statusCode === 400) {
        throw error;
      }

      if (attempt < maxRetries) {
        await sleep(1000 * attempt);
      } else {
        throw new Error('Server unreachable. Please check the hostname and try again.');
      }
    }
  }
}

function generateDeviceIdentity() {
  const deviceId = generateUUID();
  const keyPair = nacl.box.keyPair();
  
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
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
      });
    });
  }
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
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

  try {
    let deviceIdentity = await ipcRenderer.invoke('get-device-identity');
    
    if (!deviceIdentity) {
      deviceIdentity = generateDeviceIdentity();
      await ipcRenderer.invoke('save-device-identity', deviceIdentity);
    }

    let authData;

    if (isLoginMode) {
      authData = await login(hostname, username, password, deviceIdentity.device_id);
    } else {
      const recoveryCode = emberCrypto.generateRecoveryCode();
      const privateKeyBytes = naclUtil.decodeBase64(deviceIdentity.private_key);
      const recoveryData = await emberCrypto.encryptPrivateKeyWithRecoveryCode(privateKeyBytes, recoveryCode);
      authData = await register(
        hostname, 
        username, 
        password, 
        deviceIdentity.device_id, 
        deviceIdentity.public_key,
        recoveryData.encrypted,
        recoveryData.salt
      );
      authData._recoveryCode = recoveryCode;
    }

    await ipcRenderer.invoke('save-auth', {
      token: authData.token,
      user_id: authData.user_id,
      device_id: authData.device_id,
      hostname: hostname,
      username: authData.username
    });

    hideLoading();

    if (authData._recoveryCode) {
      showRecoveryCodeModal(authData._recoveryCode);
    } else {
      ipcRenderer.send('auth-success');
    }
  } catch (error) {
    hideLoading();
    console.error('Authentication error:', error);
    showError(error.message || 'An unexpected error occurred');
  }
}
