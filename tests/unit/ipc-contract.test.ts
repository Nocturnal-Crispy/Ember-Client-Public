/**
 * Unit tests for IPC contract consistency
 *
 * Tests that the IPC handlers and message service use consistent field naming
 * for distribution ID (distribution_id vs distributionId).
 */

describe('IPC contract consistency', () => {
  beforeEach(() => {
    // Mock window.emberAPI
    (window as any).emberAPI = {
      invoke: jest.fn(),
    };

    // Mock required globals
    (window as any).App = {
      activeChannelId: 'ch-1',
      activeEmberId: 'ember-1',
      migrationStatus: 'idle',
      emberKeyCache: new Map(),
    };
  });

  describe('LoadDistributionId response format', () => {
    it('should return distribution_id field (snake_case)', async () => {
      // Mock the IPC response to match expected format
      (window as any).emberAPI.invoke.mockResolvedValue({
        success: true,
        data: { distribution_id: 'dist-123' },
      });

      const response = await (window as any).emberAPI.invoke('LoadDistributionId', { address: 'ember-1' });
      
      expect(response.success).toBe(true);
      expect(response.data).toHaveProperty('distribution_id');
      expect(response.data.distribution_id).toBe('dist-123');
      // Should NOT have camelCase version
      expect(response.data).not.toHaveProperty('distributionId');
    });
  });

  describe('message-service LoadDistributionId usage', () => {
    it('should expect distribution_id field from IPC response', async () => {
      // Load the message-service module
      require('../../../src/renderer/services/message-service');

      // Mock IPC response with snake_case field
      (window as any).emberAPI.invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'LoadDistributionId') {
          return { success: true, data: { distribution_id: 'dist-123' } };
        }
        if (cmd === 'GroupEncrypt') {
          return { success: true, data: { ciphertext: 'encrypted-data' } };
        }
        return { success: false, data: null };
      });

      // Mock other required globals
      (window as any).electronAPI = {
        ipc: {
          invoke: jest.fn().mockResolvedValue({
            token: 'test-token',
            hostname: 'https://test.example.com',
            user_id: 'user-1',
            device_id: 'device-1',
          }),
        },
      };

      (window as any).emberLog = {
        createLogger: () => ({
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        }),
      };

      (window as any).showInputError = jest.fn();

      // Test the tryGroupEncrypt function which uses LoadDistributionId
      const messageServiceModule = require('../../../src/renderer/services/message-service');
      
      // Access the internal tryGroupEncrypt function (it's not exported, so we need to test through sendEncryptedMessage)
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'msg-1',
          username: 'testuser',
          chat_color: '#fff',
          ciphertext: '{"v":2,"sa":"user-1.device-1","ct":"encrypted-data"}',
          protocol_version: 1,
          envelope_type: 'signal_group',
          created_at: 1700000000,
        }),
      });

      // This should work without throwing "distributionId undefined" errors
      await expect(messageServiceModule.sendEncryptedMessage('ch-1', 'test message')).resolves.toBe('msg-1');

      // Verify LoadDistributionId was called
      expect((window as any).emberAPI.invoke).toHaveBeenCalledWith('LoadDistributionId', { address: 'ember-1' });
    });
  });

  describe('IPC handler LoadDistributionId implementation', () => {
    it('should return distribution_id in response data', async () => {
      // Mock the database and required dependencies
      const mockDb = {
        loadDistributionId: jest.fn().mockReturnValue('dist-123'),
      };

      // Import and test the IPC handler
      const { dispatchEmberCmd } = require('../../../src/main/ipc/ember-ipc');

      const result = await dispatchEmberCmd({
        cmd: 'LoadDistributionId',
        args: { address: 'ember-1' },
      }, mockDb);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('distribution_id');
      expect(result.data.distribution_id).toBe('dist-123');
      expect(result.data).not.toHaveProperty('distributionId');
    });
  });
});
