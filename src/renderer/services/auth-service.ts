/**
 * Auth service — TypeScript conversion of public/auth.js.
 * Handles login/signup/recovery flows on the auth page.
 */
(function (): void {
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger("Auth");
  const emberCrypto = window.electronAPI.crypto;

  /**
   * Safely decodes a Base64 string to Uint8Array with proper validation.
   * @param b64 - Base64 encoded string
   * @returns Uint8Array of decoded bytes
   * @throws Error with descriptive message for invalid inputs
   */
  function decodeBase64ToBytes(b64: string): Uint8Array {
    // Input validation
    if (b64 === null || b64 === undefined) {
      throw new Error('Base64 input cannot be null or undefined');
    }
    
    if (typeof b64 !== 'string') {
      throw new Error('Base64 input must be a string');
    }
    
    // Empty string is valid (decodes to empty array)
    if (b64 === '') {
      return new Uint8Array(0);
    }
    
    // Check for correct padding first
    const paddingIndex = b64.indexOf('=');
    if (paddingIndex !== -1) {
      // Padding can only appear at the end
      const hasInvalidPadding = b64.slice(paddingIndex).split('').some(char => char !== '=');
      if (hasInvalidPadding) {
        throw new Error('Invalid Base64 format: padding characters must be at the end');
      }
      
      // Maximum 2 padding characters allowed
      const paddingCount = b64.slice(paddingIndex).length;
      if (paddingCount > 2) {
        throw new Error('Invalid Base64 format: too many padding characters');
      }
    }
    
    // Base64 validation regex - matches valid Base64 characters only
    // Allows A-Z, a-z, 0-9, +, /, = for padding
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    
    if (!base64Regex.test(b64)) {
      throw new Error('Invalid Base64 format: contains characters outside valid Base64 alphabet');
    }
    
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch (error) {
      // Catch any remaining atob errors and provide a better message
      if (error instanceof DOMException) {
        throw new Error(`Base64 decoding failed: ${error.message}`);
      }
      throw new Error('Base64 decoding failed: unexpected error');
    }
  }

  function compareVersions(a: string, b: string): number {
    const partsA = a.split(".").map(Number);
    const partsB = b.split(".").map(Number);
    const len = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < len; i++) {
      const numA = partsA[i] ?? 0;
      const numB = partsB[i] ?? 0;
      if (numA < numB) return -1;
      if (numA > numB) return 1;
    }
    return 0;
  }

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

  let isLoginMode = true;
  let elements: AuthElements = {
    form: null,
    formTitle: null,
    formSubtitle: null,
    hostname: null,
    username: null,
    password: null,
    confirmPassword: null,
    confirmPasswordGroup: null,
    submitBtn: null,
    submitBtnText: null,
    toggleMode: null,
    toggleText: null,
    errorBanner: null,
    loadingOverlay: null,
    loadingText: null,
    loadingSubtext: null,
    passwordToggle: null,
    confirmPasswordToggle: null,
    minimizeBtn: null,
    maximizeBtn: null,
    closeBtn: null,
  };

  function initializeElements(): void {
    elements = {
      form: document.getElementById("auth-form") as HTMLFormElement | null,
      formTitle: document.getElementById("form-title"),
      formSubtitle: document.getElementById("form-subtitle"),
      hostname: document.getElementById("hostname") as HTMLInputElement | null,
      username: document.getElementById("username") as HTMLInputElement | null,
      password: document.getElementById("password") as HTMLInputElement | null,
      confirmPassword: document.getElementById(
        "confirm-password"
      ) as HTMLInputElement | null,
      confirmPasswordGroup: document.getElementById("confirm-password-group"),
      submitBtn: document.getElementById(
        "submit-btn"
      ) as HTMLButtonElement | null,
      submitBtnText: document.getElementById("submit-btn-text"),
      toggleMode: document.getElementById("toggle-mode"),
      toggleText: document.getElementById("toggle-text"),
      errorBanner: document.getElementById("error-banner"),
      loadingOverlay: document.getElementById("loading-overlay"),
      loadingText: document.getElementById("loading-text"),
      loadingSubtext: document.getElementById("loading-subtext"),
      passwordToggle: document.getElementById("password-toggle"),
      confirmPasswordToggle: document.getElementById("confirm-password-toggle"),
      minimizeBtn: document.getElementById("minimize-btn"),
      maximizeBtn: document.getElementById("maximize-btn"),
      closeBtn: document.getElementById("close-btn"),
    };
  }

  function attachEventListeners(): void {
    if (elements.minimizeBtn) {
      log.debug("Minimize button found, attaching listener");
      elements.minimizeBtn.addEventListener("click", () => {
        log.debug("Window minimize clicked");
        ipcRenderer.send("window-minimize");
      });
    } else {
      log.error("Minimize button NOT found in DOM");
    }

    if (elements.maximizeBtn) {
      log.debug("Maximize button found, attaching listener");
      elements.maximizeBtn.addEventListener("click", () => {
        log.debug("Window maximize clicked");
        ipcRenderer.send("window-maximize");
      });
    } else {
      log.error("Maximize button NOT found in DOM");
    }

    if (elements.closeBtn) {
      log.debug("Close button found, attaching listener");
      elements.closeBtn.addEventListener("click", () => {
        log.debug("Window close clicked");
        ipcRenderer.send("window-close");
      });
    } else {
      log.error("Close button NOT found in DOM");
    }

    if (elements.toggleMode) {
      elements.toggleMode.addEventListener("click", () => {
        isLoginMode = !isLoginMode;
        log.debug("Form mode toggled", {
          mode: isLoginMode ? "login" : "register",
        });
        updateFormMode();
      });
    }

    if (elements.passwordToggle && elements.password) {
      elements.passwordToggle.addEventListener("click", () => {
        togglePasswordVisibility(elements.password!, elements.passwordToggle!);
      });
    }

    if (elements.confirmPasswordToggle && elements.confirmPassword) {
      elements.confirmPasswordToggle.addEventListener("click", () => {
        togglePasswordVisibility(
          elements.confirmPassword!,
          elements.confirmPasswordToggle!
        );
      });
    }

    if (elements.form) {
      elements.form.addEventListener("submit", async (e: Event) => {
        e.preventDefault();
        await handleSubmit();
      });
    }
  }

  function initialize(): void {
    log.info("Auth page initializing");
    initializeElements();
    attachEventListeners();

    ipcRenderer.invoke("get-last-hostname").then((lastHostname) => {
      if (lastHostname && elements.hostname) {
        elements.hostname.value = String(lastHostname);
        log.debug("Last hostname pre-filled");
      }
    });

    log.info("Auth page initialized");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }

  function updateFormMode(): void {
    if (isLoginMode) {
      if (elements.formTitle)
        elements.formTitle.textContent = "Welcome to Ember";
      if (elements.formSubtitle)
        elements.formSubtitle.textContent = "Login to continue";
      if (elements.submitBtnText) elements.submitBtnText.textContent = "Login";
      if (elements.toggleText)
        elements.toggleText.textContent = "Need an account?";
      if (elements.toggleMode) elements.toggleMode.textContent = "Register";
      if (elements.confirmPasswordGroup)
        elements.confirmPasswordGroup.style.display = "none";
      if (elements.confirmPassword)
        elements.confirmPassword.removeAttribute("required");
      if (elements.password)
        elements.password.setAttribute("autocomplete", "current-password");
    } else {
      if (elements.formTitle) elements.formTitle.textContent = "Create Account";
      if (elements.formSubtitle)
        elements.formSubtitle.textContent = "Join the Ember community";
      if (elements.submitBtnText)
        elements.submitBtnText.textContent = "Register";
      if (elements.toggleText)
        elements.toggleText.textContent = "Already have an account?";
      if (elements.toggleMode) elements.toggleMode.textContent = "Login";
      if (elements.confirmPasswordGroup)
        elements.confirmPasswordGroup.style.display = "block";
      if (elements.confirmPassword)
        elements.confirmPassword.setAttribute("required", "required");
      if (elements.password)
        elements.password.setAttribute("autocomplete", "new-password");
    }
    hideError();
  }

  function togglePasswordVisibility(
    input: HTMLInputElement,
    _button: HTMLElement
  ): void {
    input.type = input.type === "password" ? "text" : "password";
  }

  function showError(message: string): void {
    if (elements.errorBanner) {
      elements.errorBanner.textContent = message;
      elements.errorBanner.classList.remove("hidden");
    }
  }

  function hideError(): void {
    if (elements.errorBanner) elements.errorBanner.classList.add("hidden");
  }

  function showLoading(message: string, subtext = ""): void {
    if (elements.loadingText) elements.loadingText.textContent = message;
    if (elements.loadingSubtext) elements.loadingSubtext.textContent = subtext;
    if (elements.loadingOverlay)
      elements.loadingOverlay.classList.remove("hidden");
    if (elements.submitBtn) elements.submitBtn.disabled = true;
  }

  function hideLoading(): void {
    if (elements.loadingOverlay)
      elements.loadingOverlay.classList.add("hidden");
    if (elements.submitBtn) elements.submitBtn.disabled = false;
  }

  function validateForm(): boolean {
    hideError();
    log.debug("Validating auth form", {
      mode: isLoginMode ? "login" : "register",
    });

    const hostname = elements.hostname?.value.trim() ?? "";
    const username = elements.username?.value.trim() ?? "";
    const password = elements.password?.value ?? "";
    const confirmPassword = elements.confirmPassword?.value ?? "";

    if (!hostname) {
      log.warn("Validation failed: hostname missing");
      showError("Server hostname is required");
      return false;
    }
    if (!hostname.startsWith("http://") && !hostname.startsWith("https://")) {
      log.warn("Validation failed: invalid hostname scheme");
      showError("Hostname must start with http:// or https://");
      return false;
    }
    if (!username) {
      log.warn("Validation failed: username missing");
      showError("Username is required");
      return false;
    }
    if (username.length < 3 || username.length > 20) {
      log.warn("Validation failed: username length out of range", {
        length: username.length,
      });
      showError("Username must be 3-20 characters");
      return false;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      log.warn("Validation failed: username contains invalid characters");
      showError("Username can only contain letters, numbers, and underscores");
      return false;
    }
    if (!password) {
      log.warn("Validation failed: password missing");
      showError("Password is required");
      return false;
    }
    if (password.length < 8) {
      log.warn("Validation failed: password too short");
      showError("Password must be at least 8 characters");
      return false;
    }
    if (!isLoginMode && password !== confirmPassword) {
      log.warn("Validation failed: passwords do not match");
      showError("Passwords do not match");
      return false;
    }

    log.debug("Form validation passed");
    return true;
  }

  async function generateDeviceIdentity(): Promise<DeviceIdentity> {
    log.info("Generating new device identity (keypair)");
    
    let signalIdentity;
    try {
      signalIdentity = await window.electronAPI.authService.generateDeviceIdentity() as any;
    } catch (error) {
      log.error("Failed to generate device identity", { error: (error as Error).message });
      throw new Error('Failed to generate device identity: ' + (error as Error).message);
    }
    
    if (!signalIdentity) {
      log.error("generateDeviceIdentity returned null/undefined");
      throw new Error('Failed to generate device identity: no response from service');
    }
    
    // Check if the required properties exist
    if (!signalIdentity.legacyPublicKey) {
      log.error("Signal identity missing legacyPublicKey");
      throw new Error('Failed to generate device identity: public key missing');
    }
    
    if (!signalIdentity.legacyPrivateKey) {
      log.error("Signal identity missing legacyPrivateKey");
      throw new Error('Failed to generate device identity: private key missing');
    }
    
    // Convert SignalDeviceIdentity to DeviceIdentity format for compatibility
    // Use the same conversion logic as in ember-shared
    function bytesToBase64(bytes: Uint8Array): string {
      if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
      }
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }
    
    const publicKeyBase64 = bytesToBase64(signalIdentity.legacyPublicKey);
    const privateKeyBase64 = bytesToBase64(signalIdentity.legacyPrivateKey);
    
    return {
      device_id: signalIdentity.deviceId,
      public_key: publicKeyBase64,
      private_key: privateKeyBase64
    };
  }

  async function register(
    hostname: string,
    username: string,
    password: string,
    deviceId: string,
    publicKey: string,
    encryptedDeviceKey: string,
    salt: string
  ): Promise<AuthResponse> {
    showLoading("Connecting to server...", "Registering account");
    return window.electronAPI.authService.register(
      hostname,
      username,
      password,
      deviceId,
      publicKey,
      encryptedDeviceKey,
      salt
    );
  }

  async function login(
    hostname: string,
    username: string,
    password: string,
    deviceId: string
  ): Promise<AuthResponse> {
    showLoading("Connecting to server...", "Logging in");
    return window.electronAPI.authService.login(
      hostname,
      username,
      password,
      deviceId
    );
  }

  function showRecoveryCodeModal(recoveryCode: string): void {
    log.info("Showing recovery code modal to user");
    const modal = document.getElementById("recovery-code-modal");
    const display = document.getElementById("recovery-code-display");
    const copyBtn = document.getElementById("recovery-code-copy-btn");
    const continueBtn = document.getElementById("recovery-code-continue-btn");
    if (!modal || !display) return;
    display.textContent = recoveryCode;
    modal.classList.remove("hidden");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(recoveryCode).then(() => {
          log.debug("Recovery code copied to clipboard by user");
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = "Copy to Clipboard";
          }, 2000);
        });
      });
    }
    if (continueBtn) {
      continueBtn.addEventListener("click", () => {
        log.info("User acknowledged recovery code, proceeding to main app");
        modal.classList.add("hidden");
        ipcRenderer.send("auth-success");
      });
    }
  }

  async function handleSubmit(): Promise<void> {
    if (!validateForm()) return;

    const hostname = elements.hostname?.value.trim() ?? "";
    const username = elements.username?.value.trim() ?? "";
    const password = elements.password?.value ?? "";

    log.info("Auth form submitted", {
      mode: isLoginMode ? "login" : "register",
      username,
    });

    try {
      log.debug("Loading device identity");
      let deviceIdentity = (await ipcRenderer.invoke(
        "get-device-identity"
      )) as DeviceIdentity | null;

      if (!deviceIdentity || !deviceIdentity.private_key) {
        if (!deviceIdentity) {
          log.info("No device identity found, generating new one");
        } else {
          log.info("Existing device identity incomplete (missing private key), generating new one");
        }
        deviceIdentity = await generateDeviceIdentity();
        await ipcRenderer.invoke("save-device-identity", deviceIdentity);
        log.info("New device identity saved", {
          device_id: deviceIdentity.device_id,
        });
      } else {
        log.debug("Existing device identity loaded", {
          device_id: deviceIdentity.device_id,
        });
      }

      let authData: AuthResponse;

      if (isLoginMode) {
        log.info("Initiating login request", { username });
        authData = await login(
          hostname,
          username,
          password,
          deviceIdentity.device_id
        );
        log.info("Login successful", {
          user_id: authData.user_id,
          username: authData.username,
        });
      } else {
        log.info("Initiating registration request", { username });
        const recoveryCode = emberCrypto.generateRecoveryCode();
        log.debug("Recovery code generated for new account");
        
        // Validate device identity private key before decoding
        if (!deviceIdentity.private_key) {
          throw new Error('Device identity private key is missing. Please try registering again.');
        }
        
        const privateKeyBytes = decodeBase64ToBytes(deviceIdentity.private_key);
        const recoveryData: RecoveryData =
          await emberCrypto.encryptPrivateKeyWithRecoveryCode(
            privateKeyBytes,
            recoveryCode
          );
        log.debug("Private key encrypted with recovery code");
        
        // CRITICAL FIX: Use registerWithSignalKeys to upload pre-keys during registration
        // This prevents HTTP 404 errors when establishing self-sessions later
        log.debug("Generating Signal identity for registration");
        const signalIdentity = await window.electronAPI.authService.generateDeviceIdentity() as any;
        
        if (!signalIdentity || !signalIdentity.identityKeyPair || !signalIdentity.signedPreKey || !signalIdentity.oneTimePreKeys) {
          throw new Error('Failed to generate Signal identity for registration');
        }
        
        log.debug("Registering with Signal keys", {
          deviceId: signalIdentity.deviceId,
          hasIdentityKey: !!signalIdentity.identityKeyPair,
          hasSignedPreKey: !!signalIdentity.signedPreKey,
          oneTimePreKeysCount: signalIdentity.oneTimePreKeys?.length || 0
        });
        
        authData = await window.electronAPI.authService.registerWithSignalKeys(
          hostname,
          username,
          password,
          signalIdentity,
          deviceIdentity.public_key,
          recoveryData.encrypted,
          recoveryData.salt
        );
        
        log.info("Registration successful with Signal keys", {
          user_id: authData.user_id,
          username: authData.username,
        });
        authData._recoveryCode = recoveryCode;
      }

      log.debug("Saving auth data to store");
      await ipcRenderer.invoke("save-auth", {
        token: authData.token,
        user_id: authData.user_id,
        device_id: authData.device_id,
        hostname,
        username: authData.username,
      });
      log.info("Auth data saved", {
        username: authData.username,
        user_id: authData.user_id,
      });

      // ── Minimum client version gate ────────────────────────────────────
      if (authData.minimum_client_version) {
        try {
          const appVersion = (await ipcRenderer.invoke("get-app-version")) as string;
          if (compareVersions(appVersion, authData.minimum_client_version) < 0) {
            log.warn("Client version below minimum", {
              app_version: appVersion,
              minimum: authData.minimum_client_version,
            });
            hideLoading();
            showError(
              `Your Ember client (v${appVersion}) is outdated. Please update to v${authData.minimum_client_version} or later.`
            );
            return;
          }
        } catch (versionErr) {
          log.warn("Version check failed, continuing", {
            error: (versionErr as Error).message,
          });
        }
      }

      // No migration needed for fresh database - proceed with initialization

      hideLoading();

      if (authData._recoveryCode) {
        showRecoveryCodeModal(authData._recoveryCode);
      } else {
        log.info("Authentication complete, transitioning to main app");
        ipcRenderer.send("auth-success");
      }
    } catch (error) {
      hideLoading();
      const err = error as Error;
      log.error("Authentication failed", { error: err.message });
      console.error("Authentication error:", error);
      showError(err.message || "An unexpected error occurred");
    }
  }
})();
