/**
 * Signal Session Manager — TypeScript module.
 *
 * Wrapper around SignalService that provides the interface expected by
 * DirectMessagingManager and handles session lifecycle management.
 *
 * This manager ensures proper initialization, error handling, and provides
 * a stable interface for DM encryption operations.
 */

// Uses global AuthData from globals.d.ts (shared/types/auth.ts)

// ─── Types ───────────────────────────────────────────────────────────────────

interface SignalSessionManagerInterface {
  hasSession(userId: string, deviceId: string): Promise<boolean>;
  ensureSession(userId: string, deviceId: string): Promise<void>;
  encrypt(
    recipientAddress: string,
    plaintext: Uint8Array
  ): Promise<{ ciphertext: Uint8Array; messageType: number }>;
  decrypt(senderAddress: string, ciphertext: Uint8Array, messageType: number): Promise<Uint8Array>;
  groupEncrypt(distributionId: string, plaintext: Uint8Array): Promise<Uint8Array>;
  groupDecrypt(senderAddress: string, ciphertext: Uint8Array): Promise<Uint8Array>;
  createSenderKeyDistribution(distributionId: string): Promise<Uint8Array>;
  processSenderKeyDistribution(
    senderAddress: string,
    distributionMessage: Uint8Array
  ): Promise<void>;
}

// ─── SignalSessionManager ───────────────────────────────────────────────────────

class SignalSessionManager implements SignalSessionManagerInterface {
  private readonly auth: AuthData;
  private signalService: SignalSessionManagerInterface | null = null;
  private isInitialized = false;

  constructor(auth: AuthData) {
    this.validateAuthData(auth);
    this.auth = auth;

    // Use global references to work with script loading system
    if (!(window as unknown as Record<string, unknown>)['SignalService']) {
      throw new Error('SignalService not available - check script loading order');
    }
    const SignalServiceCtor = (
      window as unknown as { SignalService: new (auth: AuthData) => SignalSessionManagerInterface }
    ).SignalService;
    this.signalService = new SignalServiceCtor(auth);
    this.isInitialized = true;
  }

  /**
   * Validate that required auth data fields are present
   */
  private validateAuthData(auth: AuthData): void {
    if (!auth || typeof auth !== 'object') {
      throw new Error('Invalid auth data: auth is required');
    }

    const requiredFields = ['token', 'hostname', 'userId', 'deviceId', 'username'];
    for (const field of requiredFields) {
      if (!(field in auth) || !auth[field as keyof AuthData]) {
        throw new Error(`Invalid auth data: ${field} is required`);
      }
    }

    // Validate hostname format
    try {
      new URL(auth.hostname);
    } catch {
      throw new Error('Invalid auth data: hostname must be a valid URL');
    }
  }

  /**
   * Ensure the manager is initialized before performing operations
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('SignalSessionManager is not initialized');
    }
  }

  /**
   * Return the SignalService instance, throwing if not initialized
   */
  private getService(): SignalSessionManagerInterface {
    if (!this.signalService) {
      throw new Error('SignalSessionManager is not initialized');
    }
    return this.signalService;
  }

  /**
   * Validate address format (userId.deviceId)
   */
  private validateAddressFormat(address: string): void {
    if (!address.includes('.')) {
      throw new Error('Invalid address format. Expected: userId.deviceId');
    }
  }

  /**
   * Validate required parameters for operations
   */
  private validateRequiredParams(params: Record<string, unknown>, required: string[]): void {
    for (const param of required) {
      if (!params[param]) {
        throw new Error(`${param} is required`);
      }
    }
  }

  /**
   * Wrap SignalService calls with consistent error handling
   */
  private async wrapSignalServiceCall<T>(operation: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw new Error(
        `Failed to ${operation}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if a Signal session exists with the specified user/device
   */
  async hasSession(userId: string, deviceId: string): Promise<boolean> {
    this.ensureInitialized();

    if (!userId || !deviceId) {
      throw new Error('userId and deviceId are required');
    }

    try {
      return await this.getService().hasSession(userId, deviceId);
    } catch (error) {
      throw new Error(
        `Failed to check session existence: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Ensure a Signal session exists with the specified user/device
   * Creates a new session if one doesn't exist
   */
  async ensureSession(userId: string, deviceId: string): Promise<void> {
    this.ensureInitialized();

    if (!userId || !deviceId) {
      throw new Error('userId and deviceId are required');
    }

    try {
      await this.getService().ensureSession(userId, deviceId);
    } catch (error) {
      throw new Error(
        `Failed to ensure session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Encrypt a message for the specified recipient using Signal Protocol
   */
  async encrypt(
    recipientAddress: string,
    plaintext: Uint8Array
  ): Promise<{ ciphertext: Uint8Array; messageType: number }> {
    this.ensureInitialized();

    this.validateRequiredParams({ recipientAddress, plaintext }, ['recipientAddress', 'plaintext']);
    this.validateAddressFormat(recipientAddress);

    return this.wrapSignalServiceCall('encrypt message', () =>
      this.getService().encrypt(recipientAddress, plaintext)
    );
  }

  /**
   * Decrypt a message from the specified sender using Signal Protocol
   */
  async decrypt(
    senderAddress: string,
    ciphertext: Uint8Array,
    messageType: number
  ): Promise<Uint8Array> {
    this.ensureInitialized();

    if (!senderAddress || !ciphertext) {
      throw new Error('senderAddress and ciphertext are required');
    }

    // Validate address format (userId.deviceId)
    if (!senderAddress.includes('.')) {
      throw new Error('Invalid sender address format. Expected: userId.deviceId');
    }

    if (typeof messageType !== 'number' || messageType < 0) {
      throw new Error('messageType must be a non-negative number');
    }

    try {
      return await this.getService().decrypt(senderAddress, ciphertext, messageType);
    } catch (error) {
      throw new Error(
        `Failed to decrypt message: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Encrypt a group message using sender keys
   */
  async groupEncrypt(distributionId: string, plaintext: Uint8Array): Promise<Uint8Array> {
    this.ensureInitialized();

    this.validateRequiredParams({ distributionId, plaintext }, ['distributionId', 'plaintext']);

    return this.wrapSignalServiceCall('encrypt group message', async () => {
      const result = await this.getService().groupEncrypt(distributionId, plaintext);

      // Handle null/undefined result as encryption not ready
      if (!result) {
        throw new Error(
          'Encryption unavailable — sender key not established. Please rejoin or restart the application.'
        );
      }

      return result;
    });
  }

  /**
   * Decrypt a group message using sender keys
   */
  async groupDecrypt(senderAddress: string, ciphertext: Uint8Array): Promise<Uint8Array> {
    this.ensureInitialized();

    if (!senderAddress || !ciphertext) {
      throw new Error('senderAddress and ciphertext are required');
    }

    // Validate address format (userId.deviceId)
    if (!senderAddress.includes('.')) {
      throw new Error('Invalid sender address format. Expected: userId.deviceId');
    }

    try {
      return await this.getService().groupDecrypt(senderAddress, ciphertext);
    } catch (error) {
      throw new Error(
        `Failed to decrypt group message: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Create a sender key distribution message for group encryption
   */
  async createSenderKeyDistribution(distributionId: string): Promise<Uint8Array> {
    this.ensureInitialized();

    if (!distributionId) {
      throw new Error('distributionId is required');
    }

    try {
      return await this.getService().createSenderKeyDistribution(distributionId);
    } catch (error) {
      throw new Error(
        `Failed to create sender key distribution: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Process a sender key distribution message
   */
  async processSenderKeyDistribution(
    senderAddress: string,
    distributionMessage: Uint8Array
  ): Promise<void> {
    this.ensureInitialized();

    this.validateRequiredParams({ senderAddress, distributionMessage }, [
      'senderAddress',
      'distributionMessage',
    ]);
    this.validateAddressFormat(senderAddress);

    return this.wrapSignalServiceCall('process sender key distribution', () =>
      this.getService().processSenderKeyDistribution(senderAddress, distributionMessage)
    );
  }

  /**
   * Get the auth data used to initialize this manager
   */
  getAuth(): AuthData {
    return { ...this.auth };
  }

  /**
   * Check if the manager is properly initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Cleanup resources (currently no-op but kept for future extensibility)
   */
  destroy(): void {
    this.isInitialized = false;

    // Clean up signal service if it has cleanup method
    const svc = this.signalService as unknown as Record<string, unknown>;
    if (svc && typeof svc['destroy'] === 'function') {
      (svc['destroy'] as () => void)();
    }

    this.signalService = null;
  }
}

// Export SignalSessionManager globally for compatibility with script loading
(window as unknown as Record<string, unknown>).SignalSessionManager = SignalSessionManager;
