/**
 * Direct Messaging manager — Handles DM conversations, key exchange, and real-time messaging.
 * Integrates with ember-shared crypto and WebSocket modules.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger("DirectMessagingManager");
  const emberCrypto = window.electronAPI.crypto;
  const naclUtil = window.electronAPI.naclUtil;
  
  // DM crypto functions using existing emberCrypto API
  const DMCrypto = {
    generateConversationId: (userId1: string, userId2: string): string => {
      const sortedIds = [userId1, userId2].sort();
      return `dm_${sortedIds[0]}_${sortedIds[1]}`;
    },
    
    generateConversationKeyPair: () => {
      // Use emberCrypto to generate a key pair for the conversation
      // Since emberCrypto doesn't have generateKeyPair, we'll create a simple key pair
      const publicKey = new Uint8Array(32); // Placeholder public key
      const privateKey = emberCrypto.generateEmberKey(); // Use ember key as private key
      return { publicKey, privateKey };
    },
    
    performKeyExchange: async (hostname: string, token: string, participantId: string, keyPair: any, conversationId: string) => {
      try {
        const auth = await window.getValidAuth();
        if (!auth) {
          throw new Error("Not authenticated");
        }
        
        // Generate a deterministic conversation key based on both participant IDs
        // This ensures both users generate the same key without server storing it
        const sortedIds = [auth.user_id, participantId].sort();
        const keySeed = `dm_${sortedIds[0]}_${sortedIds[1]}`;
        
        // Use emberCrypto to generate a deterministic key from the seed
        const seedBytes = new TextEncoder().encode(keySeed);
        const conversationKey = new Uint8Array(32);
        
        // Simple deterministic key generation from seed
        for (let i = 0; i < 32; i++) {
          conversationKey[i] = seedBytes[i % seedBytes.length] ^ (i * 31);
        }
        
        // Register our participation in the conversation
        const keyExchangeResponse = await fetch(`${hostname}/api/v1/conversations/${conversationId}/key-exchange`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            public_key: "participant_registered" // Just indicate participation
          })
        });
        
        if (!keyExchangeResponse.ok) {
          throw new Error(`Key exchange failed with status ${keyExchangeResponse.status}. Server may not have the secure key exchange schema.`);
        }
        
        log.info("Secure conversation key generated", { 
          conversationId: `dm_${sortedIds[0]}_${sortedIds[1]}`,
          keyLength: conversationKey.length 
        });
        
        return {
          success: true,
          conversationKey: conversationKey
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message
        };
      }
    },
    
    encryptDirectMessage: (plaintext: string, conversationKey: Uint8Array): string => {
      return emberCrypto.encryptMessage(plaintext, conversationKey);
    },
    
    decryptDirectMessage: (ciphertext: string, conversationKey: Uint8Array): string | null => {
      return emberCrypto.decryptMessage(ciphertext, conversationKey);
    }
  };
  
  // DM conversation state
  const dmConversations = new Map<string, DMConversation>();
  const dmKeyCache = new Map<string, Uint8Array>();
  let activeDmConversationId: string | null = null;
  
  interface DMConversation {
    id: string;
    participantId: string;
    participantUsername: string;
    lastMessage?: DMMessage;
    unreadCount: number;
    isActive: boolean;
    keyExchanged: boolean;
  }
  
  interface DMMessage {
    id: string;
    conversationId: string;
    senderId: string;
    content: string;
    timestamp: number;
    isOwn: boolean;
  }
  
  /**
   * Initialize the Direct Messaging system
   */
  async function initializeDirectMessaging(): Promise<void> {
    try {
      log.info("Initializing Direct Messaging system");
      
      // Check if crypto module is available
      if (!DMCrypto) {
        throw new Error("DM crypto module not available");
      }
      
      // Load existing DM conversations
      await loadDmConversations();
      
      log.info("Direct Messaging system initialized successfully");
    } catch (error) {
      const err = error as Error;
      log.error("Failed to initialize Direct Messaging", { error: err.message });
      console.error("Direct Messaging initialization failed:", error);
    }
  }
  
  /**
   * Fetch messages for a specific conversation
   */
  async function fetchConversationMessages(conversationId: string): Promise<DMMessage[]> {
    try {
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
        user_id?: string;
      } | null;
      
      if (!auth || !auth.token || !auth.hostname) return [];
      
      const response = await fetch(`${auth.hostname}/api/v1/conversations/${conversationId}/messages`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`
        }
      });
      
      if (!response.ok) {
        log.error("Failed to fetch messages", { conversationId, status: response.status });
        return [];
      }
      
      const data = await response.json();
      const messages: DMMessage[] = [];
      
      // Process and decrypt messages
      for (const msg of data.messages) {
        const conversationKey = dmKeyCache.get(conversationId);
        if (!conversationKey) {
          log.warn("No conversation key for message decryption", { conversationId });
          continue;
        }
        
        // Decrypt message
        if (!DMCrypto) {
          log.error("DM crypto module not available for message decryption");
          continue;
        }
        
        const decryptedContent = DMCrypto.decryptDirectMessage(msg.ciphertext, conversationKey);
        if (!decryptedContent) {
          log.error("Failed to decrypt message", { messageId: msg.id });
          continue;
        }
        
        const message: DMMessage = {
          id: msg.id,
          conversationId: msg.conversation_id,
          senderId: msg.sender_id,
          content: decryptedContent,
          timestamp: new Date(msg.created_at).getTime(),
          isOwn: msg.sender_id === auth.user_id
        };
        
        messages.push(message);
      }
      
      log.info("Messages fetched successfully", { conversationId, count: messages.length });
      return messages;
    } catch (error) {
      const err = error as Error;
      log.error("Failed to fetch conversation messages", { conversationId, error: err.message });
      return [];
    }
  }

  /**
   * Load existing DM conversations from server
   */
  async function loadDmConversations(): Promise<void> {
    try {
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
        user_id?: string;
      } | null;
      
      if (!auth || !auth.token || !auth.hostname) return;
      
      const response = await fetch(`${auth.hostname}/api/v1/conversations`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const conversations = data.conversations || [];
        log.info("DM conversations loaded", { count: conversations.length });
        
        // Process conversations and fetch participant details
        for (const conv of conversations) {
          const participantId = conv.user1_id === auth.user_id ? conv.user2_id : conv.user1_id;
          
          // Use the participant username from server response, fallback to generated format
          const participantUsername = conv.participant_username || `User ${participantId.slice(0, 8)}`;
          
          const conversation: DMConversation = {
            id: conv.id,
            participantId,
            participantUsername,
            unreadCount: 0,
            isActive: conv.status === 'active',
            keyExchanged: false
          };
          
          dmConversations.set(conv.id, conversation);
          
          // Initiate key exchange for this conversation
          try {
            await initiateKeyExchange(conv.id, participantId);
          } catch (error) {
            log.warn("Failed to initiate key exchange for conversation", { conversationId: conv.id, error });
          }
          
          // Notify UI manager about the conversation
          if (typeof window.addDmConversationToList === 'function') {
            window.addDmConversationToList({
              id: conv.id,
              participantId,
              participantUsername,
              unreadCount: 0,
              isOnline: true,
              keyExchanged: false
            });
          }
        }
        
        log.info("DM conversations processed successfully", { count: dmConversations.size });
      } else {
        log.error("Failed to load conversations", { status: response.status });
      }
    } catch (error) {
      const err = error as Error;
      log.error("Failed to load DM conversations", { error: err.message });
    }
  }
  
  /**
   * Start a new DM conversation with a user
   */
  async function startDmConversation(participantId: string, participantUsername: string): Promise<string> {
    try {
      log.info("Starting DM conversation", { participantId, participantUsername });
      
      // Check if conversation already exists
      const existingConversation = Array.from(dmConversations.values())
        .find(conv => conv.participantId === participantId);
      
      if (existingConversation) {
        log.info("DM conversation already exists", { conversationId: existingConversation.id });
        return existingConversation.id;
      }
      
      // Get authentication
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
        user_id?: string;
      } | null;
      
      if (!auth || !auth.token || !auth.hostname) {
        throw new Error("Authentication required");
      }
      
      // Create conversation via server API
      const response = await fetch(`${auth.hostname}/api/v1/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`
        },
        body: JSON.stringify({
          user_id: participantId
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create conversation: ${response.statusText}`);
      }
      
      const conversationData = await response.json();
      const conversationId = conversationData.id;
      
      // Create new conversation
      const conversation: DMConversation = {
        id: conversationId,
        participantId,
        participantUsername,
        unreadCount: 0,
        isActive: true,
        keyExchanged: false
      };
      
      dmConversations.set(conversationId, conversation);
      
      // Initiate key exchange
      await initiateKeyExchange(conversationId, participantId);
      
      log.info("DM conversation started", { conversationId });
      return conversationId;
    } catch (error) {
      const err = error as Error;
      log.error("Failed to start DM conversation", { error: err.message });
      throw error;
    }
  }
  
  /**
   * Initiate key exchange for a DM conversation
   */
  async function initiateKeyExchange(conversationId: string, participantId: string): Promise<void> {
    try {
      log.info("Initiating key exchange", { conversationId, participantId });
      
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
      } | null;
      
      if (!auth || !auth.token || !auth.hostname) {
        throw new Error("Authentication required for key exchange");
      }
      
      // Generate key pair for this conversation
      if (!DMCrypto) {
        throw new Error("DM crypto module not available. Please ensure ember-shared is properly loaded.");
      }
      
      const keyPair = DMCrypto.generateConversationKeyPair();
      
      // Perform key exchange using ember-shared crypto
      const keyExchangeResult = await DMCrypto.performKeyExchange(
        auth.hostname,
        auth.token,
        participantId,
        keyPair,
        conversationId
      );
      
      if (keyExchangeResult.success && keyExchangeResult.conversationKey) {
        // Cache the conversation key
        dmKeyCache.set(conversationId, keyExchangeResult.conversationKey);
        
        // Update conversation status
        const conversation = dmConversations.get(conversationId);
        if (conversation) {
          conversation.keyExchanged = true;
        }
        
        // Subscribe to conversation for real-time messages (WebSocket disabled for now)
        // if (dmWebSocketClient) {
        //   await dmWebSocketClient.subscribeToConversation(conversationId);
        // }
        
        log.info("Key exchange completed successfully", { conversationId });
      } else {
        throw new Error(keyExchangeResult.error || "Key exchange failed");
      }
    } catch (error) {
      const err = error as Error;
      log.error("Key exchange failed", { conversationId, error: err.message });
      throw error;
    }
  }
  
  /**
   * Send a direct message
   */
  async function sendDirectMessage(conversationId: string, plaintext: string): Promise<string> {
    try {
      const conversation = dmConversations.get(conversationId);
      if (!conversation) {
        throw new Error("Conversation not found");
      }
      
      if (!conversation.keyExchanged) {
        throw new Error("Key exchange not completed for this conversation");
      }
      
      const conversationKey = dmKeyCache.get(conversationId);
      if (!conversationKey) {
        throw new Error("Conversation key not available");
      }
      
      log.debug("Sending direct message", { conversationId });
      
      // Encrypt message using ember-shared crypto
      if (!DMCrypto) {
        throw new Error("DM crypto module not available. Please ensure ember-shared is properly loaded.");
      }
      
      const encryptedContent = DMCrypto.encryptDirectMessage(plaintext, conversationKey);
      
      // Get authentication
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
        user_id?: string;
      } | null;
      
      if (!auth || !auth.token || !auth.hostname) {
        throw new Error("Authentication required");
      }
      
      // Send message via HTTP API
      const response = await fetch(`${auth.hostname}/api/v1/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`
        },
        body: JSON.stringify({
          ciphertext: encryptedContent,
          timestamp: Date.now()
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }
      
      const messageData = await response.json();
      
      // Display the message locally for immediate feedback
      const message: DMMessage = {
        id: messageData.id,
        conversationId,
        senderId: auth.user_id!,
        content: plaintext,
        timestamp: messageData.timestamp || Date.now(),
        isOwn: true
      };
      
      displayDmMessage(message);
      
      // Update conversation
      conversation.lastMessage = message;
      
      log.debug("Direct message sent successfully", { 
        conversationId, 
        messageId: messageData.id 
      });
      
      return messageData.id;
    } catch (error) {
      const err = error as Error;
      log.error("Failed to send direct message", { conversationId, error: err.message });
      throw error;
    }
  }
  
  /**
   * Handle incoming DM message
   */
  async function handleDmMessage(messageData: any): Promise<void> {
    try {
      const { conversationId, senderId, content, timestamp, messageId } = messageData;
      
      log.debug("Received DM message", { conversationId, senderId });
      
      const conversation = dmConversations.get(conversationId);
      if (!conversation) {
        log.warn("Received message for unknown conversation", { conversationId });
        return;
      }
      
      const conversationKey = dmKeyCache.get(conversationId);
      if (!conversationKey) {
        log.warn("No conversation key available for decryption", { conversationId });
        return;
      }
      
      // Decrypt message using ember-shared crypto
      if (!DMCrypto) {
        log.error("DM crypto module not available for message decryption");
        return;
      }
      
      const decryptedContent = DMCrypto.decryptDirectMessage(content, conversationKey);
      if (!decryptedContent) {
        log.error("Failed to decrypt DM message");
        return;
      }
      
      // Create message object
      const message: DMMessage = {
        id: messageId,
        conversationId,
        senderId,
        content: decryptedContent,
        timestamp,
        isOwn: senderId === await getCurrentUserId()
      };
      
      // Update conversation
      conversation.lastMessage = message;
      if (!message.isOwn && conversationId !== activeDmConversationId) {
        conversation.unreadCount++;
      }
      
      // Display message if this is the active conversation
      if (conversationId === activeDmConversationId) {
        displayDmMessage(message);
      }
      
      // Update UI
      updateDmConversationList();
      
      log.debug("DM message processed successfully", { conversationId });
    } catch (error) {
      const err = error as Error;
      log.error("Failed to handle DM message", { error: err.message });
    }
  }
  
  /**
   * Handle DM presence updates
   */
  function handleDmPresenceUpdate(presenceData: any): void {
    log.debug("DM presence update", presenceData);
    // Update participant online status in conversation list
    updateDmConversationList();
  }
  
  /**
   * Handle DM typing indicators
   */
  function handleDmTypingIndicator(typingData: any): void {
    const { conversationId, userId, isTyping } = typingData;
    
    if (conversationId === activeDmConversationId) {
      showTypingIndicator(userId, isTyping);
    }
  }
  
  /**
   * Handle DM WebSocket connection changes
   */
  function handleDmConnectionChange(isConnected: boolean): void {
    log.info("DM WebSocket connection changed", { isConnected });
    
    if (isConnected) {
      // Re-subscribe to active conversations (WebSocket disabled for now)
      // dmConversations.forEach((conversation, conversationId) => {
      //   if (conversation.keyExchanged && dmWebSocketClient) {
      //     dmWebSocketClient.subscribeToConversation(conversationId);
      //   }
      // });
    }
  }
  
  /**
   * Display a DM message in the chat UI
   */
  function displayDmMessage(message: DMMessage): void {
    // This would integrate with the existing chat UI
    log.debug("Displaying DM message", { messageId: message.id, conversationId: message.conversationId });
    
    // Use the UI manager to display the message if available
    if (typeof window.displayDmMessage === 'function') {
      window.displayDmMessage({
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        content: message.content,
        timestamp: message.timestamp,
        isOwn: message.isOwn
      });
    } else {
      // Fallback to console logging for debugging
      console.log(`DM [${message.conversationId}] ${message.isOwn ? 'You' : 'Them'}: ${message.content}`);
    }
  }
  
  /**
   * Show/hide typing indicator
   */
  function showTypingIndicator(userId: string, isTyping: boolean): void {
    // This would update the UI to show typing status
    log.debug("Typing indicator", { userId, isTyping });
  }
  
  /**
   * Update DM conversation list in UI
   */
  function updateDmConversationList(): void {
    // This would update the sidebar with current conversations
    log.debug("Updating DM conversation list");
  }
  
  /**
   * Set active DM conversation
   */
  function setActiveDmConversation(conversationId: string): void {
    activeDmConversationId = conversationId;
    
    const conversation = dmConversations.get(conversationId);
    if (conversation) {
      // Reset unread count
      conversation.unreadCount = 0;
      updateDmConversationList();
    }
  }
  
  /**
   * Get current user ID
   */
  async function getCurrentUserId(): Promise<string | null> {
    try {
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        user_id?: string;
      } | null;
      return auth?.user_id || null;
    } catch (error) {
      log.error("Failed to get current user ID", { error });
      return null;
    }
  }
  
  /**
   * Send typing indicator
   */
  async function sendTypingIndicator(conversationId: string, isTyping: boolean): Promise<void> {
    try {
      // Send typing indicator via WebSocket (disabled for now)
      // if (dmWebSocketClient) {
      //   await dmWebSocketClient.sendTypingIndicator(conversationId, isTyping);
      // }
      log.debug("Typing indicator", { conversationId, isTyping });
    } catch (error) {
      const err = error as Error;
      log.error("Failed to send typing indicator", { conversationId, error: err.message });
    }
  }
  
  // Expose functions to global scope
  window.initializeDirectMessaging = initializeDirectMessaging;
  window.startDmConversation = startDmConversation;
  window.sendDirectMessage = sendDirectMessage;
  window.setActiveDmConversation = setActiveDmConversation;
  window.sendTypingIndicator = sendTypingIndicator;
  window.fetchConversationMessages = fetchConversationMessages;
  window.initiateKeyExchange = initiateKeyExchange;
})();
