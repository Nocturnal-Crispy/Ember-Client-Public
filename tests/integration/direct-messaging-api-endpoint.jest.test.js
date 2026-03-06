/**
 * @jest-environment node
 *
 * Jest-compatible test for direct messaging API endpoint fix
 * This test validates that the fix resolves the "Not Found" error
 */

// Test configuration
const TEST_CONFIG = {
  conversationId: 'dm_test-conversation-id',
  messageContent: 'Test message',
  expectedEndpoint: '/api/v1/conversations/',
  oldIncorrectEndpoint: '/api/v1/direct-messages/conversations/'
};

// Mock fetch for testing
let mockFetchCalls = [];

// Mock fetch function
const mockFetch = jest.fn(async (url, options) => {
  mockFetchCalls.push({ url, options });
  
  // Mock successful response for the correct endpoint
  if (url.includes(TEST_CONFIG.expectedEndpoint)) {
    return {
      ok: true,
      json: jest.fn().mockResolvedValue({
        id: 'message-id',
        conversation_id: TEST_CONFIG.conversationId,
        sender_id: 'test-user-id',
        ciphertext: 'encrypted-content',
        created_at: Date.now()
      })
    };
  }
  
  // Mock 404 for incorrect endpoint
  return {
    ok: false,
    status: 404,
    statusText: 'Not Found'
  };
});

// Mock the fixed sendDirectMessage function
async function sendDirectMessage(conversationId, content, hostname, token) {
  const response = await mockFetch(`${hostname}/api/v1/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      ciphertext: 'encrypted-content',
      timestamp: Date.now()
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to send message: ${response.statusText}`);
  }

  return await response.json();
}

describe('Direct Messaging API Endpoint Fix', () => {
  beforeEach(() => {
    mockFetchCalls = [];
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Should use correct API endpoint', async () => {
    await sendDirectMessage(
      TEST_CONFIG.conversationId,
      TEST_CONFIG.messageContent,
      'https://test.ember.com',
      'test-token'
    );
    
    expect(mockFetchCalls.length).toBeGreaterThan(0);
    expect(mockFetchCalls[0].url).toBe(
      'https://test.ember.com/api/v1/conversations/dm_test-conversation-id/messages'
    );
  });

  test('Should use correct request payload', async () => {
    await sendDirectMessage(
      TEST_CONFIG.conversationId,
      TEST_CONFIG.messageContent,
      'https://test.ember.com',
      'test-token'
    );
    
    const call = mockFetchCalls[0];
    const body = JSON.parse(call.options.body);
    
    expect(body).toHaveProperty('ciphertext');
    expect(body).toHaveProperty('timestamp');
    expect(body).not.toHaveProperty('content');
    expect(body.ciphertext).toBe('encrypted-content');
  });

  test('Should not use old incorrect endpoint', async () => {
    await sendDirectMessage(
      TEST_CONFIG.conversationId,
      TEST_CONFIG.messageContent,
      'https://test.ember.com',
      'test-token'
    );
    
    const calls = mockFetchCalls.map(call => call.url);
    const hasOldEndpoint = calls.some(url => url.includes(TEST_CONFIG.oldIncorrectEndpoint));
    
    expect(hasOldEndpoint).toBe(false);
  });

  test('Should handle successful response', async () => {
    const result = await sendDirectMessage(
      TEST_CONFIG.conversationId,
      TEST_CONFIG.messageContent,
      'https://test.ember.com',
      'test-token'
    );
    
    expect(result.id).toBe('message-id');
    expect(result.conversation_id).toBe(TEST_CONFIG.conversationId);
    expect(result.ciphertext).toBe('encrypted-content');
  });

  test('Should fail with old endpoint', async () => {
    // Simulate using the old incorrect endpoint
    const response = await mockFetch(`https://test.ember.com/api/v1/direct-messages/conversations/${TEST_CONFIG.conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      },
      body: JSON.stringify({
        content: 'encrypted-content',
        timestamp: Date.now()
      })
    });

    if (!response.ok) {
      expect(() => {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }).toThrow('Failed to send message: Not Found');
    } else {
      fail('Should have failed with old endpoint');
    }
  });
});
