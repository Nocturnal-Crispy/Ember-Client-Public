/**
 * Unit tests for Sprint 6 cutover behavior in
 * src/renderer/services/message-service.ts
 */

beforeAll(() => {
  const existing = document.getElementById("messages");
  if (existing) existing.remove();
  const messagesEl = document.createElement("div");
  messagesEl.id = "messages";
  document.body.appendChild(messagesEl);

  // 1. Populate window.App
  require("../../src/renderer/managers/app-state");

  // 2. Mock window.electronAPI
  (window as any).electronAPI = {
    ipc: {
      invoke: jest.fn().mockImplementation(async (channel: string) => {
        if (channel === "get-auth") {
          return {
            token: "token-1",
            hostname: "https://example.com",
            user_id: "user-1",
            device_id: "device-1",
            username: "alice",
          };
        }
        return null;
      }),
      send: jest.fn(),
      on: jest.fn(),
    },
    crypto: {
      // No legacy decrypt during hard cutover.
    },
    nacl: {},
    naclUtil: {
      decodeBase64: jest.fn().mockReturnValue(new Uint8Array([9, 9, 9])),
    },
    messageService: {
      // Legacy fallback must not be used after Sprint 6 Phase 2.
      sendMessage: jest.fn(),
      editMessage: jest.fn(),
      fetchMessages: jest.fn().mockResolvedValue({ messages: [], hasMore: false }),
    },
  };

  // 3. Mock window.emberAPI (Signal sender-key + legacy key archive)
  (window as any).emberAPI = {
    invoke: jest.fn().mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "LoadDistributionId":
          return { success: true, data: { distribution_id: "dist-1" } };
        case "GroupEncrypt":
          return { success: true, data: { ciphertext: "enc-b64" } };
        case "GroupDecrypt":
          // Return plaintext base64 for "hello"
          return {
            success: true,
            data: { plaintext: Buffer.from("hello", "utf8").toString("base64") },
          };
        case "LoadLegacyEmberKey":
          return { success: true, data: { key: "aGVsbG8=" } };
        default:
          return { success: false, data: null };
      }
    }),
  };

  // 4. Mock window.emberLog (createLogger called at load time)
  (window as any).emberLog = {
    createLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  };

  // 5. Provide required globals
  (window as any).showInputError = jest.fn();
  (window as any).processIncomingDistributions = jest.fn();
  (window as any).registerSentMessageId = jest.fn();

  // 6. Load UI helpers then message-service module
  require("../../src/renderer/components/messages-area");
  require("../../src/renderer/services/message-service");
});

describe("message-service cutover", () => {
  beforeEach(() => {
    window.App.activeChannelId = "ch-1";
    window.App.activeEmberId = "ember-1";
    window.App.migrationStatus = "idle";
    window.App.emberKeyCache.set("ember-1", new Uint8Array([1, 2, 3]));

    // Reset mocks
    (window as any).showInputError.mockClear();
    (window as any).emberAPI.invoke.mockClear();
  });

  it("sendEncryptedMessage sends protocol_version=1 + envelope_type=signal_group", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "msg-1",
        username: "alice",
        chat_color: "#fff",
        ciphertext: '{"v":2,"sa":"user-1.device-1","ct":"enc-b64"}',
        protocol_version: 1,
        envelope_type: "signal_group",
        created_at: 1700000000,
      }),
    });
    (global as any).fetch = fetchMock;

    const msgId = await (window as any).sendEncryptedMessage("ch-1", "hello");
    expect(msgId).toBe("msg-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.protocol_version).toBe(1);
    expect(body.envelope_type).toBe("signal_group");

    // Legacy fallback must not be used.
    expect((window as any).electronAPI.messageService.sendMessage).not.toHaveBeenCalled();
  });

  it("sendEncryptedMessage throws a descriptive error when Signal encryption is not ready", async () => {
    // Make LoadDistributionId return no distribution_id -> tryGroupEncrypt() => null
    (window as any).emberAPI.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "LoadDistributionId") return { success: true, data: { distribution_id: null } };
      return { success: false, data: null };
    });

    (global as any).fetch = jest.fn();

    await expect((window as any).sendEncryptedMessage("ch-1", "hello")).rejects.toThrow(/Signal Protocol encryption not ready/i);
    expect((window as any).showInputError).toHaveBeenCalled();
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('displayDecryptedMessage shows placeholder for legacy envelope_type', async () => {
    const msg = {
      id: "msg-legacy-1",
      username: "alice",
      chat_color: "#fff",
      ciphertext: "legacy-ciphertext",
      protocol_version: 0,
      envelope_type: "legacy",
      created_at: 1700000000,
    };

    await (window as any).displayDecryptedMessage(msg, false);

    const messagesText = document.getElementById("messages")?.textContent ?? "";
    expect(messagesText).toContain("[Failed to decrypt message]");
  });
});

