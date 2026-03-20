/**
 * Recovery Migration Manager
 *
 * After Signal Protocol migration, re-encrypts the recovery code to wrap the
 * new Ed25519 identity key instead of the legacy Curve25519 key. Generates a
 * new 24-digit recovery code, uploads the encrypted data to the server, and
 * shows the code to the user for confirmation.
 */

interface RecoveryReEncryptionResult {
  readonly success: boolean;
  readonly recoveryCode?: string;
  readonly error?: string;
}

interface RecoveryAuthParams {
  readonly hostname: string;
  readonly token: string;
  readonly user_id: string;
  readonly device_id: string;
}

/**
 * Performs recovery code re-encryption after Signal migration.
 *
 * 1. Retrieves the new identity private key from safeStorage via ember IPC
 * 2. Generates a new 24-digit recovery code
 * 3. Encrypts the identity key with the recovery code (PBKDF2 + NaCl secretbox)
 * 4. Uploads the encrypted data to the server via PATCH /api/v1/recovery-codes
 * 5. Returns the new recovery code for display to the user
 */
export async function reEncryptRecoveryCode(auth: RecoveryAuthParams): Promise<RecoveryReEncryptionResult> {
  const log = window.emberLog.createLogger("RecoveryMigration");
  log.info("Starting recovery code re-encryption");
  try {
    const ipcRenderer = window.electronAPI.ipc;
    const emberCrypto = window.electronAPI.crypto;
    const safeStorageResult = await window.emberAPI.invoke<{ value: string | null }>(
      "GetSafeStorage",
      { key: `identity_key_${auth.user_id}_${auth.device_id}` },
    );
    const identityKeyB64 = safeStorageResult.data?.value ?? null;
    if (!identityKeyB64) {
      return { success: false, error: "Identity key not found in safe storage" };
    }
    const identityKeyBytes = Uint8Array.from(atob(identityKeyB64), (c) => c.charCodeAt(0));
    const recoveryCode = emberCrypto.generateRecoveryCode(24);
    const { encrypted, salt } = await emberCrypto.encryptPrivateKeyWithRecoveryCode(
      identityKeyBytes,
      recoveryCode,
    );
    const patchResponse = await fetch(`${auth.hostname}/api/v1/recovery-codes`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({
        encrypted_device_key: encrypted,
        salt,
      }),
    });
    if (!patchResponse.ok) {
      const errText = await patchResponse.text().catch(() => "");
      return { success: false, error: `Server update failed: ${patchResponse.status} ${errText}` };
    }
    log.info("Recovery code re-encryption complete");
    return { success: true, recoveryCode };
  } catch (err) {
    const error = (err as Error).message;
    log.error("Recovery code re-encryption failed", { error });
    return { success: false, error };
  }
}

/**
 * Shows the recovery code confirmation modal after migration.
 * Reuses the existing recovery-code-modal HTML.
 */
export function showMigrationRecoveryModal(recoveryCode: string, onConfirm: () => void): void {
  const log = window.emberLog.createLogger("RecoveryMigration");
  log.info("Showing migration recovery code modal");
  const modal = document.getElementById("recovery-code-modal");
  const display = document.getElementById("recovery-code-display");
  const copyBtn = document.getElementById("recovery-code-copy-btn");
  const continueBtn = document.getElementById("recovery-code-continue-btn");
  if (!modal || !display) {
    log.warn("Recovery code modal elements not found, skipping display");
    onConfirm();
    return;
  }
  display.textContent = recoveryCode;
  modal.classList.remove("hidden");
  if (copyBtn) {
    const handler = (): void => {
      navigator.clipboard.writeText(recoveryCode).then(() => {
        log.debug("Migration recovery code copied to clipboard");
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy to Clipboard";
        }, 2000);
      });
    };
    copyBtn.replaceWith(copyBtn.cloneNode(true));
    document.getElementById("recovery-code-copy-btn")?.addEventListener("click", handler);
  }
  if (continueBtn) {
    const handler = (): void => {
      log.info("User acknowledged migration recovery code");
      modal.classList.add("hidden");
      onConfirm();
    };
    continueBtn.replaceWith(continueBtn.cloneNode(true));
    document.getElementById("recovery-code-continue-btn")?.addEventListener("click", handler);
  }
}
