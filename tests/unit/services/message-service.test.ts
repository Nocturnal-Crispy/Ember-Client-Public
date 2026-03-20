/**
 * Unit tests for src/renderer/services/message-service.ts
 *
 * The IIFE captures window.App, window.electronAPI, and window.emberLog at
 * load time, so all mocks must be set up before require()-ing the module.
 *
 * Tests cover:
 *   - formatTimestamp: today, yesterday, older dates
 *   - escapeHtml: HTML special characters escaped via DOM innerHTML
 *   - addMessage: DOM element creation and insertion into #messages
 */

beforeAll(() => {
  // 1. Create messages container BEFORE loading modules (since they capture it at load time)
  const container = document.createElement('div');
  container.id = 'messages';
  document.body.appendChild(container);

  // 2. Populate window.App
  require('../../../src/renderer/managers/app-state');

  // 3. Mock window.electronAPI (ipc + crypto needed at load time)
  (window as any).electronAPI = {
    ipc: {
      invoke: jest.fn().mockResolvedValue(null),
      send: jest.fn(),
      on: jest.fn(),
    },
    crypto: {
      encryptMessage: jest.fn().mockReturnValue('encrypted'),
      decryptMessage: jest.fn().mockReturnValue('decrypted'),
    },
    nacl: {},
    naclUtil: {},
    messageService: {
      fetchMessages: jest.fn().mockResolvedValue({ messages: [], hasMore: false }),
      sendMessage: jest.fn().mockResolvedValue({ id: 'msg-1', ciphertext: 'enc' }),
    },
  };

  // 4. Mock window.emberLog (createLogger called at load time)
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  (window as any).emberLog = {
    createLogger: () => mockLogger,
  };
  // Store mockLogger globally for test access
  (window as any)._mockLogger = mockLogger;

  // 5. Stub window.wsSubscribeToChannel (called by loadChannelMessages)
  (window as any).wsSubscribeToChannel = jest.fn();

  // 6. Load messages-area first (sets window.createBasicMessageElement, window.formatTimestamp, etc.)
  require('../../../src/renderer/components/messages-area');

  // 7. Load message-service (sets window.escapeHtml, window.addMessage, etc.)
  require('../../../src/renderer/services/message-service');
});

// Mock emberAPI for sender key tests
let mockEmberApiInvokeForSenderKeys: jest.Mock;
let mockProcessIncomingDistributions: jest.Mock;

beforeEach(() => {
  mockEmberApiInvokeForSenderKeys = jest.fn();
  mockProcessIncomingDistributions = jest.fn().mockResolvedValue(undefined);
  
  (window as any).emberAPI = {
    invoke: mockEmberApiInvokeForSenderKeys,
  };
  
  (window as any).processIncomingDistributions = mockProcessIncomingDistributions;
  
  // Reset logger mock
  const mockLogger = (window as any)._mockLogger;
  mockLogger.warn.mockClear();
});

// ─── formatTimestamp ──────────────────────────────────────────────────────────

describe('formatTimestamp', () => {
  it('returns a string starting with "Today at" when called without arguments', () => {
    const result = (window as any).formatTimestamp();
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^Today at /);
  });

  it('returns a string starting with "Today at" for a timestamp equal to now', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = (window as any).formatTimestamp(nowSeconds);
    expect(result).toMatch(/^Today at /);
  });

  it('returns a string starting with "Yesterday at" for yesterday\'s timestamp', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const unixSeconds = Math.floor(yesterday.getTime() / 1000);
    const result = (window as any).formatTimestamp(unixSeconds);
    expect(result).toMatch(/^Yesterday at /);
  });

  it('returns a non-empty string containing a colon for any past timestamp', () => {
    // Use a fixed old date (2020-01-01 00:00:00 UTC)
    const result = (window as any).formatTimestamp(1577836800);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain(':');
  });

  it('does not start with "Today at" for a distant past timestamp', () => {
    const result = (window as any).formatTimestamp(1577836800); // 2020-01-01
    expect(result).not.toMatch(/^Today at /);
    expect(result).not.toMatch(/^Yesterday at /);
  });
});

// ─── escapeHtml ───────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes < and > characters', () => {
    const result = (window as any).escapeHtml('<b>bold</b>');
    expect(result).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('escapes & characters', () => {
    const result = (window as any).escapeHtml('a & b');
    expect(result).toBe('a &amp; b');
  });

  it('escapes all special characters together', () => {
    const result = (window as any).escapeHtml('<script>&');
    expect(result).toBe('&lt;script&gt;&amp;');
  });

  it('returns an empty string unchanged', () => {
    expect((window as any).escapeHtml('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect((window as any).escapeHtml('hello world')).toBe('hello world');
  });
});

// ─── addMessage ───────────────────────────────────────────────────────────────

describe('addMessage', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // addMessage uses document.getElementById('messages') captured at load time.
    // Since the module was loaded without a #messages element, messagesContainer
    // inside the closure is null. We can test DOM creation by inspecting the
    // element that addMessage creates before appending.
    //
    // Alternatively, append the container now and test via the exported window fn
    // after re-requiring — but module caching prevents re-execution of the IIFE.
    // Instead, we verify the function does not throw and test the DOM structure
    // by calling addMessage with a fresh #messages element appended to document.
    container = document.createElement('div');
    container.id = 'messages-test'; // separate id to avoid collision
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('does not throw when called (messagesContainer may be null from IIFE load)', () => {
    // The IIFE captured messagesContainer = null at load time.
    // addMessage guards with `if (messagesContainer)` so it is a safe no-op.
    expect(() => {
      (window as any).addMessage('Alice', 'Hello', 1700000000);
    }).not.toThrow();
  });

  it('addMessage function is exported and callable', () => {
    expect(typeof (window as any).addMessage).toBe('function');
  });

  it('formatTimestamp and escapeHtml are both exported', () => {
    expect(typeof (window as any).formatTimestamp).toBe('function');
    expect(typeof (window as any).escapeHtml).toBe('function');
  });
});

// ─── Sender Key Decryption Tests ───────────────────────────────────────────────────

describe('Sender Key Decryption', () => {
  beforeEach(() => {
    // Set up active ember for message display
    (window as any).App.activeEmberId = 'test-ember-id';
    
    // Mock GroupDecrypt to fail (simulating missing sender key)
    mockEmberApiInvokeForSenderKeys.mockImplementation((cmd: string) => {
      if (cmd === 'GroupDecrypt') {
        return Promise.resolve({ success: true, data: { plaintext: null } }); // Decrypt fails
      }
      return Promise.resolve({ success: true, data: null });
    });
  });

  it('should have displayDecryptedMessage function available', () => {
    expect(typeof (window as any).displayDecryptedMessage).toBe('function');
  });

  it('should log warning and trigger distribution fetch when sender key decrypt fails', async () => {
    const mockLogger = (window as any)._mockLogger;
    
    // Create a message with signal_group envelope type
    const message = {
      id: 'test-message-id',
      username: 'Alice',
      ciphertext: '{"v":2,"sa":"user.device","ct":"encrypted"}',
      envelope_type: 'signal_group',
      created_at: 1700000000,
      chat_color: '#ff0000'
    };

    // Call displayDecryptedMessage which should trigger the failure path
    await (window as any).displayDecryptedMessage?.(message);

    // Verify warning was logged with the specific message
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Sender key decrypt failed, triggering distribution fetch",
      { message_id: 'test-message-id' }
    );

    // Verify processIncomingDistributions was called (synchronously now)
    expect(mockProcessIncomingDistributions).toHaveBeenCalled();
  });

  it('should display waiting message when sender key decrypt fails', async () => {
    // Clear any existing messages from the container
    const container = document.getElementById('messages')!;
    container.innerHTML = '';

    // Create a message with signal_group envelope type
    const message = {
      id: 'test-message-id',
      username: 'Alice',
      ciphertext: '{"v":2,"sa":"user.device","ct":"encrypted"}',
      envelope_type: 'signal_group',
      created_at: 1700000000,
      chat_color: '#ff0000'
    };

    // Call displayDecryptedMessage which should trigger the failure path
    await (window as any).displayDecryptedMessage?.(message);

    // Check that a "waiting for sender key" message was added
    const waitingMessage = container.querySelector('.message-content');
    expect(waitingMessage).toBeTruthy();
    expect(waitingMessage?.textContent).toContain('Waiting for sender key');
  });

  it('should successfully decrypt after sender key distribution is processed', async () => {
    // Clear any existing messages from the container
    const container = document.getElementById('messages')!;
    container.innerHTML = '';

    // Mock GroupDecrypt to fail initially, then succeed after distribution
    let decryptAttempts = 0;
    mockEmberApiInvokeForSenderKeys.mockImplementation((cmd: string) => {
      if (cmd === 'GroupDecrypt') {
        decryptAttempts++;
        if (decryptAttempts === 1) {
          return Promise.resolve({ success: true, data: { plaintext: null } }); // First attempt fails
        } else {
          return Promise.resolve({ success: true, data: { plaintext: 'SGVsbG8gV29ybGQ=' } }); // Second attempt succeeds
        }
      }
      return Promise.resolve({ success: true, data: null });
    });

    // Create a message with signal_group envelope type
    const message = {
      id: 'test-message-id',
      username: 'Alice',
      ciphertext: '{"v":2,"sa":"user.device","ct":"encrypted"}',
      envelope_type: 'signal_group',
      created_at: 1700000000,
      chat_color: '#ff0000'
    };

    // Call displayDecryptedMessage - should fail initially, fetch distribution, then retry and succeed
    await (window as any).displayDecryptedMessage?.(message);

    // Verify the message was successfully decrypted (not waiting message)
    const decryptedMessage = container.querySelector('.message-content');
    expect(decryptedMessage?.textContent).toContain('Hello World');
    
    // Verify no waiting message is shown
    expect(decryptedMessage?.textContent).not.toContain('Waiting for sender key');
    
    // Verify processIncomingDistributions was called
    expect(mockProcessIncomingDistributions).toHaveBeenCalled();
    
    // Verify GroupDecrypt was called twice (initial fail + retry)
    expect(decryptAttempts).toBe(2);
  });
});
