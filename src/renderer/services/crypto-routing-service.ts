/**
 * CryptoRoutingService — Signal Protocol group messaging state machine.
 * Handles encryption mode selection, decryption routing by wire type,
 * and sender key lifecycle transitions.
 */
(function (): void {
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger('CryptoRoutingService');

  // ─── Constants ──────────────────────────────────────────────────────────

  const SK_VERSION = 2;

  // ─── Helpers ────────────────────────────────────────────────────────────

  function textToBase64(text: string): string {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function base64ToText(b64: string): string {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  // ─── Encryption Mode Selection ──────────────────────────────────────────

  /**
   * Select the encryption mode for an outgoing message.
   * Returns 'sender_key' if the ember has 3+ members and sender key is active,
   * otherwise returns 'pairwise'.
   */
  function selectEncryptionMode(emberId: string, memberCount: number): 'pairwise' | 'sender_key' {
    const useSenderKey = window.shouldUseSenderKey(emberId, memberCount);
    log.debug('Encryption mode selected', {
      ember_id: emberId,
      member_count: memberCount,
      mode: useSenderKey ? 'sender_key' : 'pairwise',
    });
    return useSenderKey ? 'sender_key' : 'pairwise';
  }

  // ─── Encryption ─────────────────────────────────────────────────────────

  /**
   * Encrypt a plaintext message using the appropriate mode for the ember.
   * For sender_key mode: uses GroupCipher via IPC, wraps in SK_VERSION=2 envelope.
   * For pairwise mode: returns null (caller falls back to existing pairwise encryption).
   */
  async function encryptMessage(
    plaintext: string,
    emberId: string,
    memberCount: number
  ): Promise<{ ciphertext: string; wireType: 'sender_key' } | null> {
    const mode = selectEncryptionMode(emberId, memberCount);

    if (mode === 'pairwise') {
      return null; // Caller handles pairwise encryption
    }

    try {
      // Load distribution ID for this ember
      let distResp = await window.emberAPI.invoke<{
        distributionId: string | null;
      }>('LoadDistributionId', { address: emberId });

      if (!distResp.success || !distResp.data?.distributionId) {
        log.warn('Distribution ID missing — attempting sender key recovery', { ember_id: emberId });
        const recovered = await window.ensureSenderKeyForEmber?.(emberId);
        if (!recovered) {
          log.warn('Sender key recovery failed — falling back to pairwise', { ember_id: emberId });
          return null;
        }
        distResp = { success: true, data: { distributionId: recovered } };
      }

      const plaintextB64 = textToBase64(plaintext);
      const encResp = await window.emberAPI.invoke<{ ciphertext: string }>('GroupEncrypt', {
        distributionId: distResp.data!.distributionId!,
        plaintext: plaintextB64,
      });

      if (!encResp.success || !encResp.data?.ciphertext) {
        log.warn('GroupEncrypt failed', {
          ember_id: emberId,
          error: encResp.error ?? 'unknown',
        });
        return null;
      }

      const auth = (await ipcRenderer.invoke('get-auth')) as {
        user_id?: string;
        device_id?: string;
      } | null;
      if (!auth?.user_id || !auth?.device_id) return null;

      const envelope = JSON.stringify({
        v: SK_VERSION,
        sa: `${auth.user_id}.${auth.device_id}`,
        ct: encResp.data.ciphertext,
      });

      return { ciphertext: envelope, wireType: 'sender_key' };
    } catch (err) {
      log.error('encryptMessage exception', {
        ember_id: emberId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  // ─── Decryption Routing ─────────────────────────────────────────────────

  /**
   * Detect wire type from ciphertext content.
   * SK_VERSION=2 messages start with '{"v":2'.
   */
  function detectWireType(ciphertext: string): 'sender_key' | 'signal' {
    if (ciphertext.startsWith('{"v":2')) {
      return 'sender_key';
    }
    return 'signal';
  }

  /**
   * Route decryption based on wire type detected from the message.
   * ALWAYS routes by message content, NEVER by conversation type.
   */
  async function decryptMessage(ciphertext: string, emberId: string): Promise<string | null> {
    const wireType = detectWireType(ciphertext);

    log.debug('Decryption routing', {
      ember_id: emberId,
      wire_type: wireType,
    });

    switch (wireType) {
      case 'sender_key':
        return decryptSenderKey(ciphertext);
      case 'signal':
        return null; // Caller handles pairwise/session decryption
      default:
        log.error('Unknown wire type', { wire_type: wireType });
        return null;
    }
  }

  /**
   * Decrypt a sender-key encrypted message (SK_VERSION=2 envelope).
   */
  async function decryptSenderKey(ciphertext: string): Promise<string | null> {
    try {
      const envelope = JSON.parse(ciphertext) as {
        v?: number;
        sa?: string;
        ct?: string;
      };

      if (envelope.v !== SK_VERSION || !envelope.sa || !envelope.ct) {
        log.warn('Invalid sender key envelope', {
          has_version: envelope.v !== undefined,
          has_sender: envelope.sa !== undefined,
          has_ciphertext: envelope.ct !== undefined,
        });
        return null;
      }

      const decResp = await window.emberAPI.invoke<{ plaintext: string }>('GroupDecrypt', {
        senderAddress: envelope.sa,
        ciphertext: envelope.ct,
      });

      if (!decResp.success || !decResp.data?.plaintext) {
        log.warn('GroupDecrypt failed', {
          sender_address: envelope.sa,
          error: decResp.error ?? 'unknown',
        });
        return null;
      }

      return base64ToText(decResp.data.plaintext);
    } catch (err) {
      log.error('decryptSenderKey exception', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  // ─── Lifecycle Transitions ──────────────────────────────────────────────

  /**
   * Handle a new member being added to an ember.
   * If member count reaches 3+ and sender key is not initialized,
   * transitions to 'distributing' state.
   */
  function onMemberAdded(emberId: string, memberCount: number): void {
    const state = window.getCryptoState(emberId);

    if (memberCount >= 3 && state.senderKeyStatus === 'not_initialized') {
      log.info('Transitioning to sender key distribution', {
        ember_id: emberId,
        member_count: memberCount,
      });
      window.setCryptoState(emberId, {
        senderKeyStatus: 'distributing',
      });
    }
  }

  /**
   * Handle a member being removed from an ember.
   * If sender key was active, transitions to 'rotation_required'.
   * If member count drops below 3, reverts to pairwise.
   */
  function onMemberRemoved(emberId: string, memberCount: number): void {
    const state = window.getCryptoState(emberId);

    if (memberCount < 3) {
      log.info('Reverting to pairwise — member count below threshold', {
        ember_id: emberId,
        member_count: memberCount,
      });
      window.setCryptoState(emberId, {
        cryptoMode: 'pairwise_bootstrap',
        senderKeyStatus: 'not_initialized',
        activeDistributionId: null,
      });
      return;
    }

    if (state.cryptoMode === 'sender_key_active') {
      log.info('Sender key rotation required — member removed', {
        ember_id: emberId,
        member_count: memberCount,
      });
      window.setCryptoState(emberId, {
        senderKeyStatus: 'rotation_required',
      });
    }
  }

  /**
   * Mark sender key distribution as complete for an ember.
   * Transitions from 'distributing' to 'sender_key_active'.
   */
  function onDistributionComplete(emberId: string, distributionId: string): void {
    log.info('Sender key distribution complete — activating', {
      ember_id: emberId,
    });
    window.setCryptoState(emberId, {
      cryptoMode: 'sender_key_active',
      senderKeyStatus: 'active',
      activeDistributionId: distributionId,
    });
  }

  /**
   * Mark sender key rotation as complete.
   * Increments epoch and reactivates sender key.
   */
  function onRotationComplete(emberId: string, newDistributionId: string): void {
    const state = window.getCryptoState(emberId);
    log.info('Sender key rotation complete', {
      ember_id: emberId,
      new_epoch: state.senderKeyEpoch + 1,
    });
    window.setCryptoState(emberId, {
      senderKeyStatus: 'active',
      activeDistributionId: newDistributionId,
      senderKeyEpoch: state.senderKeyEpoch + 1,
    });
  }

  // ─── Validation ─────────────────────────────────────────────────────────

  /**
   * Validate an incoming sender key message against the current crypto state.
   * Returns an error string if validation fails, null if valid.
   */
  function validateSenderKeyMessage(emberId: string, _senderAddress: string): string | null {
    const state = window.getCryptoState(emberId);

    if (state.senderKeyStatus !== 'active') {
      return `sender key not active for ember ${emberId} (status: ${state.senderKeyStatus})`;
    }

    if (!state.activeDistributionId) {
      return `no active distribution ID for ember ${emberId}`;
    }

    return null;
  }

  // ─── Global Exports ─────────────────────────────────────────────────────

  window.cryptoRouting = {
    selectEncryptionMode,
    encryptMessage,
    decryptMessage,
    detectWireType,
    onMemberAdded,
    onMemberRemoved,
    onDistributionComplete,
    onRotationComplete,
    validateSenderKeyMessage,
  };
})();
