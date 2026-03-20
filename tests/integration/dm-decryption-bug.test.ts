/**
 * @jest-environment node
 *
 * Test that reproduces the specific DM decryption bug where messages return null.
 * This test focuses on the ember key caching and retrieval mechanism for DMs.
 */

import {
  generateEmberKey,
  encryptEmberKeyForUser,
  decryptEmberKeyForUser,
  encryptMessage,
  decryptMessage,
} from 'ember-shared';

const nacl: any = {};

// Mock the App.emberKeyCache system that's used in the actual code
const mockEmberKeyCache = new Map<string, Uint8Array>();

// Mock the direct messaging manager functions
class MockDirectMessagingManager {
  private dmByTextChannel = new Map<string, { emberId: string; partnerId: string }>();
  
  addDmEntry(textChannelId: string, emberId: string, partnerId: string) {
    this.dmByTextChannel.set(textChannelId, { emberId, partnerId });
  }
  
  async fetchAndCacheEmberKey(emberId: string): Promise<Uint8Array | null> {
    // Simulate the cache check
    if (mockEmberKeyCache.has(emberId)) {
      return mockEmberKeyCache.get(emberId) ?? null;
    }
    
    // Simulate fetching from server (for this test, we'll pre-populate)
    // In the real bug, this might be failing or returning wrong key
    return null;
  }
  
  async fetchConversationMessages(channelId: string): Promise<Array<{
    id: string;
    conversationId: string;
    senderId: string;
    content: string;
    timestamp: number;
    isOwn: boolean;
  }>> {
    const entry = this.dmByTextChannel.get(channelId);
    if (!entry) return [];
    
    const emberKey = await this.fetchAndCacheEmberKey(entry.emberId);
    if (!emberKey) {
      // This is where the bug manifests - emberKey is null
      console.warn('Ember key not found for DM:', entry.emberId);
      return [];
    }
    
    // Simulate some encrypted messages
    const messages = [
      { id: 'msg1', sender_user_id: 'alice', ciphertext: '', created_at: Date.now() / 1000 },
      { id: 'msg2', sender_user_id: 'bob', ciphertext: '', created_at: Date.now() / 1000 }
    ];
    
    return messages.map(msg => {
      const plaintext = decryptMessage(msg.ciphertext, emberKey) ?? "";
      return {
        id: msg.id,
        conversationId: channelId,
        senderId: msg.sender_user_id,
        content: plaintext,
        timestamp: msg.created_at,
        isOwn: msg.sender_user_id === 'alice'
      };
    });
  }
}

describe.skip('DM Decryption Bug Reproduction', () => {
  let alice: any;
  let bob: any;
  let dmManager: MockDirectMessagingManager;

  beforeAll(() => {
    alice = nacl.box.keyPair();
    bob = nacl.box.keyPair();
    dmManager = new MockDirectMessagingManager();
  });

  beforeEach(() => {
    mockEmberKeyCache.clear();
  });

  test('reproduces DM decryption failure when ember key is not cached', async () => {
    // Setup: Create a DM conversation
    const dmChannelId = 'dm-channel-1';
    const dmEmberId = 'dm-ember-1';
    dmManager.addDmEntry(dmChannelId, dmEmberId, 'bob');
    
    // Generate and encrypt the ember key (as would happen in real DM creation)
    const emberKey = generateEmberKey();
    const encryptedKeyForBob = encryptEmberKeyForUser(emberKey, bob.publicKey, alice.secretKey);
    
    // Simulate the bug: ember key is NOT properly cached
    // This is the core issue - fetchAndCacheEmberKey fails to populate the cache
    // mockEmberKeyCache.set(dmEmberId, emberKey); // This line is missing in real bug
    
    // Create an encrypted message
    const plaintext = 'Hello Bob, this is a secret DM!';
    const ciphertext = encryptMessage(plaintext, emberKey);
    
    // Simulate receiving this message via WebSocket
    const mockMessage = {
      id: 'msg1',
      channel_id: dmChannelId,
      sender_user_id: 'alice',
      ciphertext: ciphertext,
      created_at: Date.now() / 1000
    };
    
    // Try to decrypt using the DM flow
    const entry = dmManager['dmByTextChannel'].get(dmChannelId);
    const retrievedEmberKey = await dmManager.fetchAndCacheEmberKey(entry!.emberId);
    
    // This should reproduce the bug: retrievedEmberKey is null
    expect(retrievedEmberKey).toBeNull();
    
    // This demonstrates the bug: decryption returns null because key is null
    const decryptedContent = decryptMessage(mockMessage.ciphertext, retrievedEmberKey!);
    expect(decryptedContent).toBeNull();
  });

  test('shows that proper ember key caching fixes DM decryption', async () => {
    // Setup: Create a DM conversation with proper key caching
    const dmChannelId = 'dm-channel-2';
    const dmEmberId = 'dm-ember-2';
    dmManager.addDmEntry(dmChannelId, dmEmberId, 'bob');
    
    // Generate and properly cache the ember key
    const emberKey = generateEmberKey();
    mockEmberKeyCache.set(dmEmberId, emberKey); // Proper caching
    
    // Create an encrypted message
    const plaintext = 'Hello Bob, this should work!';
    const ciphertext = encryptMessage(plaintext, emberKey);
    
    // Retrieve the ember key (should work now)
    const retrievedEmberKey = await dmManager.fetchAndCacheEmberKey(dmEmberId);
    expect(retrievedEmberKey).not.toBeNull();
    expect(retrievedEmberKey).toEqual(emberKey);
    
    // Decryption should work
    const decryptedContent = decryptMessage(ciphertext, retrievedEmberKey!);
    expect(decryptedContent).toBe(plaintext);
  });

  test('demonstrates difference between DM and channel key retrieval', () => {
    // Simulate channel message flow (for comparison)
    const channelEmberId = 'channel-ember-1';
    const channelEmberKey = generateEmberKey();
    
    // Channels typically have their ember keys cached when channel is loaded
    mockEmberKeyCache.set(channelEmberId, channelEmberKey);
    
    // Channel message decryption
    const channelPlaintext = 'Channel message';
    const channelCiphertext = encryptMessage(channelPlaintext, channelEmberKey);
    const retrievedChannelKey = mockEmberKeyCache.get(channelEmberId);
    
    const channelDecrypted = decryptMessage(channelCiphertext, retrievedChannelKey!);
    expect(channelDecrypted).toBe(channelPlaintext);
    
    // This test shows that the issue is specific to DM key retrieval,
    // not the crypto primitives themselves
  });
});
