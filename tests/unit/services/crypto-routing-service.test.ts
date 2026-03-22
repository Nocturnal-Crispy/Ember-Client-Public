/**
 * RED tests for CryptoRoutingService — Signal Protocol group messaging state machine.
 * Tests all 8 scenarios from the architecture document.
 */

// Mock window globals before requiring the IIFE module
const mockLog = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const mockEmberAPI = {
  invoke: jest.fn(),
};

const mockIpcRenderer = {
  invoke: jest.fn(),
  send: jest.fn(),
  on: jest.fn(),
};

// Crypto state storage for tests
const cryptoStates = new Map<
  string,
  {
    cryptoMode: string;
    senderKeyStatus: string;
    activeDistributionId: string | null;
    senderKeyEpoch: number;
  }
>();

const DEFAULT_STATE = {
  cryptoMode: 'pairwise_bootstrap',
  senderKeyStatus: 'not_initialized',
  activeDistributionId: null,
  senderKeyEpoch: 0,
};

beforeAll(() => {
  // In jsdom, window already exists — set properties on it directly
  (window as any).App = { activeEmberId: 'test-ember-1' };
  (window as any).electronAPI = {
    ipc: mockIpcRenderer,
    crypto: {},
  };
  (window as any).emberLog = {
    createLogger: () => mockLog,
  };
  (window as any).emberAPI = mockEmberAPI;
  (window as any).getCryptoState = jest.fn((emberId: string) => {
    return cryptoStates.get(emberId) ?? { ...DEFAULT_STATE };
  });
  (window as any).setCryptoState = jest.fn((emberId: string, update: Record<string, unknown>) => {
    const current = cryptoStates.get(emberId) ?? { ...DEFAULT_STATE };
    const next = { ...current, ...update };
    cryptoStates.set(emberId, next);
    return next;
  });
  (window as any).shouldUseSenderKey = jest.fn((emberId: string, memberCount: number) => {
    const state = cryptoStates.get(emberId) ?? { ...DEFAULT_STATE };
    return memberCount >= 3 && state.senderKeyStatus === 'active';
  });
  (window as any).ensureSenderKeyForEmber = jest.fn();

  // Load the IIFE module — it will set window.cryptoRouting
  require('../../../src/renderer/services/crypto-routing-service');
});

beforeEach(() => {
  jest.clearAllMocks();
  cryptoStates.clear();
});

describe('CryptoRoutingService', () => {
  // ─── Scenario 1: Group of 1 uses pairwise only ──────────────────────

  describe('Scenario 1: Group of 1 (pairwise only)', () => {
    it('should select pairwise mode for single-member group', () => {
      const mode = (window as any).cryptoRouting.selectEncryptionMode('ember-1', 1);
      expect(mode).toBe('pairwise');
    });

    it('should select pairwise mode for two-member group', () => {
      const mode = (window as any).cryptoRouting.selectEncryptionMode('ember-1', 2);
      expect(mode).toBe('pairwise');
    });

    it('should return null from encryptMessage for pairwise mode', async () => {
      const result = await (window as any).cryptoRouting.encryptMessage('hello', 'ember-1', 1);
      expect(result).toBeNull();
    });
  });

  // ─── Scenario 2: Add member triggers distribution bootstrap ─────────

  describe('Scenario 2: Add member triggers bootstrap', () => {
    it('should transition to distributing when 3rd member added', () => {
      cryptoStates.set('ember-2', { ...DEFAULT_STATE });

      (window as any).cryptoRouting.onMemberAdded('ember-2', 3);

      expect((window as any).setCryptoState).toHaveBeenCalledWith('ember-2', {
        senderKeyStatus: 'distributing',
      });
    });

    it('should not transition if already distributing', () => {
      cryptoStates.set('ember-2', {
        ...DEFAULT_STATE,
        senderKeyStatus: 'distributing',
      });

      (window as any).cryptoRouting.onMemberAdded('ember-2', 4);

      expect((window as any).setCryptoState).not.toHaveBeenCalled();
    });
  });

  // ─── Scenario 3: All members acked → sender_key_active ─────────────

  describe('Scenario 3: Distribution complete activates sender key', () => {
    it('should activate sender key mode on distribution complete', () => {
      cryptoStates.set('ember-3', {
        ...DEFAULT_STATE,
        senderKeyStatus: 'distributing',
      });

      (window as any).cryptoRouting.onDistributionComplete('ember-3', 'dist-id-123');

      expect((window as any).setCryptoState).toHaveBeenCalledWith('ember-3', {
        cryptoMode: 'sender_key_active',
        senderKeyStatus: 'active',
        activeDistributionId: 'dist-id-123',
      });
    });

    it('should select sender_key mode after activation with 3+ members', () => {
      cryptoStates.set('ember-3', {
        cryptoMode: 'sender_key_active',
        senderKeyStatus: 'active',
        activeDistributionId: 'dist-id-123',
        senderKeyEpoch: 0,
      });

      const mode = (window as any).cryptoRouting.selectEncryptionMode('ember-3', 3);
      expect(mode).toBe('sender_key');
    });
  });

  // ─── Scenario 4: Invalid/missing sender key rejection ──────────────

  describe('Scenario 4: Invalid sender key rejection', () => {
    it('should fail validation when sender key not active', () => {
      cryptoStates.set('ember-4', { ...DEFAULT_STATE });

      const error = (window as any).cryptoRouting.validateSenderKeyMessage(
        'ember-4',
        'user.device'
      );
      expect(error).not.toBeNull();
      expect(error).toContain('not active');
    });

    it('should fail validation when no active distribution ID', () => {
      cryptoStates.set('ember-4', {
        cryptoMode: 'sender_key_active',
        senderKeyStatus: 'active',
        activeDistributionId: null,
        senderKeyEpoch: 0,
      });

      const error = (window as any).cryptoRouting.validateSenderKeyMessage(
        'ember-4',
        'user.device'
      );
      expect(error).not.toBeNull();
      expect(error).toContain('no active distribution');
    });
  });

  // ─── Scenario 5: Distribution ID mismatch rejection ────────────────

  describe('Scenario 5: Distribution ID mismatch', () => {
    it('should detect wire type from ciphertext content', () => {
      const senderKeyMsg = '{"v":2,"sa":"user.dev","ct":"encrypted"}';
      const pairwiseMsg = 'base64encodedciphertext';

      expect((window as any).cryptoRouting.detectWireType(senderKeyMsg)).toBe('sender_key');
      expect((window as any).cryptoRouting.detectWireType(pairwiseMsg)).toBe('signal');
    });

    it('should return null for invalid SK_VERSION envelope', async () => {
      const badEnvelope = JSON.stringify({ v: 1, sa: 'user.dev', ct: 'data' });
      const result = await (window as any).cryptoRouting.decryptMessage(badEnvelope, 'ember-5');
      // Should fail because v:1 is not recognized as sender_key (starts with {"v":1 not {"v":2)
      // So detectWireType returns 'signal', and decryptMessage returns null for signal type
      expect(result).toBeNull();
    });
  });

  // ─── Scenario 6: Membership removal triggers rotation ──────────────

  describe('Scenario 6: Membership removal rotation', () => {
    it('should require rotation when member removed from active group', () => {
      cryptoStates.set('ember-6', {
        cryptoMode: 'sender_key_active',
        senderKeyStatus: 'active',
        activeDistributionId: 'dist-123',
        senderKeyEpoch: 1,
      });

      (window as any).cryptoRouting.onMemberRemoved('ember-6', 4);

      expect((window as any).setCryptoState).toHaveBeenCalledWith('ember-6', {
        senderKeyStatus: 'rotation_required',
      });
    });

    it('should revert to pairwise when member count drops below 3', () => {
      cryptoStates.set('ember-6', {
        cryptoMode: 'sender_key_active',
        senderKeyStatus: 'active',
        activeDistributionId: 'dist-123',
        senderKeyEpoch: 1,
      });

      (window as any).cryptoRouting.onMemberRemoved('ember-6', 2);

      expect((window as any).setCryptoState).toHaveBeenCalledWith('ember-6', {
        cryptoMode: 'pairwise_bootstrap',
        senderKeyStatus: 'not_initialized',
        activeDistributionId: null,
      });
    });

    it('should increment epoch on rotation complete', () => {
      cryptoStates.set('ember-6', {
        cryptoMode: 'sender_key_active',
        senderKeyStatus: 'rotation_required',
        activeDistributionId: 'old-dist',
        senderKeyEpoch: 1,
      });

      (window as any).cryptoRouting.onRotationComplete('ember-6', 'new-dist-456');

      expect((window as any).setCryptoState).toHaveBeenCalledWith('ember-6', {
        senderKeyStatus: 'active',
        activeDistributionId: 'new-dist-456',
        senderKeyEpoch: 2,
      });
    });
  });

  // ─── Scenario 7: Out-of-order message delivery ─────────────────────

  describe('Scenario 7: Out-of-order delivery', () => {
    it('should handle sender key message when state is pairwise gracefully', async () => {
      cryptoStates.set('ember-7', { ...DEFAULT_STATE });

      const senderKeyMsg = JSON.stringify({
        v: 2,
        sa: 'user.device',
        ct: 'somebase64ciphertext',
      });

      // GroupDecrypt should be attempted but may fail
      mockEmberAPI.invoke.mockResolvedValueOnce({
        success: false,
        error: 'no sender key installed',
      });

      const result = await (window as any).cryptoRouting.decryptMessage(senderKeyMsg, 'ember-7');
      expect(result).toBeNull();
    });
  });

  // ─── Scenario 8: Multi-device distribution ─────────────────────────

  describe('Scenario 8: Multi-device handling', () => {
    it('should encrypt with sender auth including device ID', async () => {
      cryptoStates.set('ember-8', {
        cryptoMode: 'sender_key_active',
        senderKeyStatus: 'active',
        activeDistributionId: 'dist-multi',
        senderKeyEpoch: 0,
      });

      mockEmberAPI.invoke
        .mockResolvedValueOnce({ success: true, data: { distributionId: 'dist-multi' } }) // LoadDistributionId
        .mockResolvedValueOnce({ success: true, data: { ciphertext: 'encrypted-data' } }); // GroupEncrypt

      mockIpcRenderer.invoke.mockResolvedValueOnce({
        user_id: 'user-123',
        device_id: 'device-456',
      });

      const result = await (window as any).cryptoRouting.encryptMessage(
        'hello world',
        'ember-8',
        5
      );

      expect(result).not.toBeNull();
      expect(result!.wireType).toBe('sender_key');

      const envelope = JSON.parse(result!.ciphertext);
      expect(envelope.v).toBe(2);
      expect(envelope.sa).toBe('user-123.device-456');
      expect(envelope.ct).toBe('encrypted-data');
    });
  });
});
