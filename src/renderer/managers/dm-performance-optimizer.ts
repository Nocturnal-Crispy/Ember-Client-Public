/**
 * Direct Messaging Performance Optimizer
 * Handles message caching, lazy loading, and performance optimizations
 */

interface DMMessageCache {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  timestamp: number;
  isOwn: boolean;
  decryptedContent?: string;
  isLoading?: boolean;
}

interface DMConversationCache {
  id: string;
  participantId: string;
  participantUsername: string;
  messages: DMMessageCache[];
  oldestMessageId?: string;
  newestMessageId?: string;
  hasMoreMessages: boolean;
  unreadCount: number;
  lastActivity: number;
  isFullyLoaded: boolean;
}

interface PerformanceConfig {
  maxCacheSize: number;
  maxMessagesPerConversation: number;
  messagePageSize: number;
  cacheExpirationTime: number;
  preloadThreshold: number;
}

class DMPerformanceOptimizer {
  private conversationCache = new Map<string, DMConversationCache>();
  private messageCache = new Map<string, DMMessageCache>();
  private loadingPromises = new Map<string, Promise<void>>();
  private config: PerformanceConfig;
  private eventListeners = new Map<string, Function[]>();
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = {
      maxCacheSize: 1000,
      maxMessagesPerConversation: 200,
      messagePageSize: 50,
      cacheExpirationTime: 30 * 60 * 1000, // 30 minutes
      preloadThreshold: 10, // Preload when 10 messages from bottom
      ...config,
    };

    // Start cleanup interval
    this.cleanupIntervalId = setInterval(
      () => this.cleanupCache(),
      this.config.cacheExpirationTime
    );
  }

  /**
   * Stop the cache cleanup interval and release resources.
   */
  destroy(): void {
    if (this.cleanupIntervalId !== null) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    this.conversationCache.clear();
    this.messageCache.clear();
    this.loadingPromises.clear();
    this.eventListeners.clear();
  }

  /**
   * Get cached conversation or load from server
   */
  async getConversation(
    conversationId: string,
    forceRefresh = false
  ): Promise<DMConversationCache | null> {
    const cached = this.conversationCache.get(conversationId);

    if (!forceRefresh && cached && !this.isCacheExpired(cached.lastActivity)) {
      return cached;
    }

    // Check if already loading
    const existingPromise = this.loadingPromises.get(conversationId);
    if (existingPromise) {
      await existingPromise;
      return this.conversationCache.get(conversationId) || null;
    }

    // Load conversation
    const loadPromise = this.loadConversationFromServer(conversationId);
    this.loadingPromises.set(conversationId, loadPromise);

    try {
      await loadPromise;
      return this.conversationCache.get(conversationId) || null;
    } finally {
      this.loadingPromises.delete(conversationId);
    }
  }

  /**
   * Get messages for a conversation with lazy loading
   */
  async getMessages(
    conversationId: string,
    beforeMessageId?: string,
    limit = this.config.messagePageSize
  ): Promise<DMMessageCache[]> {
    const conversation = this.conversationCache.get(conversationId);
    if (!conversation) {
      return [];
    }

    // If we have cached messages and no specific request, return cached
    if (!beforeMessageId && conversation.messages.length > 0) {
      return conversation.messages;
    }

    // Check if we need to load more messages
    if (beforeMessageId || conversation.hasMoreMessages) {
      await this.loadMessagesFromServer(conversationId, beforeMessageId, limit);
    }

    return this.conversationCache.get(conversationId)?.messages || [];
  }

  /**
   * Add new message to cache
   */
  addMessage(message: DMMessageCache): void {
    const conversation = this.conversationCache.get(message.conversationId);
    if (!conversation) {
      return;
    }

    // Check if message already exists
    const existingIndex = conversation.messages.findIndex(m => m.id === message.id);
    if (existingIndex !== -1) {
      // Update existing message
      conversation.messages[existingIndex] = message;
    } else {
      // Add new message in chronological order
      const insertIndex = conversation.messages.findIndex(m => m.timestamp > message.timestamp);
      if (insertIndex === -1) {
        conversation.messages.push(message);
      } else {
        conversation.messages.splice(insertIndex, 0, message);
      }

      // Update newest message ID
      if (
        !conversation.newestMessageId ||
        message.timestamp >
          (conversation.messages.find(m => m.id === conversation.newestMessageId)?.timestamp || 0)
      ) {
        conversation.newestMessageId = message.id;
      }

      // Update oldest message ID
      if (
        !conversation.oldestMessageId ||
        message.timestamp <
          (conversation.messages.find(m => m.id === conversation.oldestMessageId)?.timestamp ||
            Infinity)
      ) {
        conversation.oldestMessageId = message.id;
      }
    }

    // Update last activity
    conversation.lastActivity = Date.now();

    // Trim messages if exceeding limit
    this.trimConversationMessages(conversation);

    // Emit message added event
    this.emit('messageAdded', { conversationId: message.conversationId, message });

    // Check if we should preload more messages
    this.checkPreloadThreshold(conversation);
  }

  /**
   * Mark messages as read
   */
  markMessagesAsRead(conversationId: string, upToMessageId?: string): void {
    const conversation = this.conversationCache.get(conversationId);
    if (!conversation) {
      return;
    }

    let readCount = 0;
    conversation.messages.forEach(message => {
      if (!message.isOwn && !message.isLoading) {
        if (
          !upToMessageId ||
          message.timestamp <=
            (conversation.messages.find(m => m.id === upToMessageId)?.timestamp || Infinity)
        ) {
          // Mark as read (you might want to add a read flag to the message interface)
          readCount++;
        }
      }
    });

    conversation.unreadCount = Math.max(0, conversation.unreadCount - readCount);
    conversation.lastActivity = Date.now();

    this.emit('messagesRead', { conversationId, readCount });
  }

  /**
   * Search messages within conversations
   */
  async searchMessages(query: string, conversationIds?: string[]): Promise<DMMessageCache[]> {
    const results: DMMessageCache[] = [];
    const conversationsToSearch = conversationIds || Array.from(this.conversationCache.keys());

    for (const conversationId of conversationsToSearch) {
      const conversation = this.conversationCache.get(conversationId);
      if (!conversation) continue;

      // Search in cached messages first
      const cachedResults = conversation.messages.filter(message =>
        message.decryptedContent?.toLowerCase().includes(query.toLowerCase())
      );
      results.push(...cachedResults);

      // If conversation is not fully loaded, search server as well
      if (!conversation.isFullyLoaded) {
        try {
          const serverResults = await this.searchMessagesOnServer(conversationId, query);
          results.push(...serverResults);
        } catch (error) {
          console.warn(
            `Failed to search messages on server for conversation ${conversationId}:`,
            error
          );
        }
      }
    }

    // Sort by timestamp (newest first)
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get conversation statistics
   */
  getConversationStats(conversationId: string): {
    messageCount: number;
    unreadCount: number;
    lastActivity: number;
    isFullyLoaded: boolean;
    cacheHitRate: number;
  } | null {
    const conversation = this.conversationCache.get(conversationId);
    if (!conversation) {
      return null;
    }

    return {
      messageCount: conversation.messages.length,
      unreadCount: conversation.unreadCount,
      lastActivity: conversation.lastActivity,
      isFullyLoaded: conversation.isFullyLoaded,
      cacheHitRate: this.calculateCacheHitRate(conversationId),
    };
  }

  /**
   * Clear cache for specific conversation or all
   */
  clearCache(conversationId?: string): void {
    if (conversationId) {
      this.conversationCache.delete(conversationId);
      // Also remove individual messages from message cache
      for (const [messageId, message] of this.messageCache.entries()) {
        if (message.conversationId === conversationId) {
          this.messageCache.delete(messageId);
        }
      }
    } else {
      this.conversationCache.clear();
      this.messageCache.clear();
    }

    this.emit('cacheCleared', { conversationId });
  }

  /**
   * Add event listener
   */
  on(event: string, callback: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  /**
   * Remove event listener
   */
  off(event: string, callback: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Emit event
   */
  private emit(event: string, data: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Load conversation from server
   */
  private async loadConversationFromServer(conversationId: string): Promise<void> {
    try {
      // This would make an API call to load conversation info
      const response = await fetch(`/api/v1/conversations/${conversationId}`);
      if (!response.ok) {
        throw new Error(`Failed to load conversation: ${response.statusText}`);
      }

      const conversationData = await response.json();

      const conversation: DMConversationCache = {
        id: conversationData.id,
        participantId: conversationData.participant_id,
        participantUsername: conversationData.participant_username,
        messages: [],
        hasMoreMessages: true,
        unreadCount: conversationData.unread_count || 0,
        lastActivity: Date.now(),
        isFullyLoaded: false,
      };

      this.conversationCache.set(conversationId, conversation);

      // Load initial messages
      await this.loadMessagesFromServer(conversationId);
    } catch (error) {
      console.error(`Failed to load conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Load messages from server
   */
  private async loadMessagesFromServer(
    conversationId: string,
    beforeMessageId?: string,
    limit = this.config.messagePageSize
  ): Promise<void> {
    try {
      const conversation = this.conversationCache.get(conversationId);
      if (!conversation) {
        return;
      }

      const url = new URL(
        `/api/v1/conversations/${conversationId}/messages`,
        window.location.origin
      );
      if (beforeMessageId) {
        url.searchParams.set('before', beforeMessageId);
      }
      url.searchParams.set('limit', limit.toString());

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${await this.getAuthToken()}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to load messages: ${response.statusText}`);
      }

      const data = await response.json();
      let currentUserId: string;
      try {
        currentUserId = await this.getCurrentUserId();
      } catch (error) {
        console.error('Failed to get current user ID:', error);
        throw new Error('Authentication failed');
      }

      // Create a Set for efficient duplicate checking
      const existingMessageIds = new Set(conversation.messages.map(m => m.id));

      const messages: DMMessageCache[] = data.messages.map((msg: any) => ({
        id: msg.id,
        conversationId: msg.conversation_id,
        senderId: msg.sender_id,
        content: msg.ciphertext,
        timestamp: new Date(msg.created_at).getTime(),
        isOwn: msg.sender_id === currentUserId,
        isLoading: true,
      }));

      // Add messages to cache and conversation efficiently
      messages.forEach(message => {
        this.messageCache.set(message.id, message);
        if (!existingMessageIds.has(message.id)) {
          conversation.messages.push(message);
        }
      });

      // Sort messages by timestamp only if new messages were added
      if (messages.some(m => !existingMessageIds.has(m.id))) {
        conversation.messages.sort((a, b) => a.timestamp - b.timestamp);
      }

      // Update conversation state
      conversation.hasMoreMessages = data.has_more;
      conversation.lastActivity = Date.now();

      if (!data.has_more) {
        conversation.isFullyLoaded = true;
      }

      // Update message IDs
      if (conversation.messages.length > 0) {
        conversation.oldestMessageId = conversation.messages[0].id;
        conversation.newestMessageId = conversation.messages[conversation.messages.length - 1].id;
      }

      // Trim if necessary
      this.trimConversationMessages(conversation);

      // Decrypt messages progressively
      this.decryptMessagesProgressively(conversation, messages);

      this.emit('messagesLoaded', { conversationId, messages, hasMore: data.has_more });
    } catch (error) {
      console.error(`Failed to load messages for conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Decrypt messages progressively to avoid blocking UI
   */
  private decryptMessagesProgressively(
    conversation: DMConversationCache,
    messages: DMMessageCache[]
  ): void {
    const decryptBatch = async (batch: DMMessageCache[]) => {
      for (const message of batch) {
        if (message.isLoading && message.content) {
          try {
            // This would use the DM crypto to decrypt
            const decryptedContent = await this.decryptMessage(message.content, conversation.id);
            message.decryptedContent = decryptedContent;
            message.isLoading = false;

            // Update in message cache too
            this.messageCache.set(message.id, message);

            // Emit progress event
            this.emit('messageDecrypted', { conversationId: conversation.id, message });

            // Small delay to prevent blocking
            await new Promise(resolve => setTimeout(resolve, 0));
          } catch (error) {
            console.error(`Failed to decrypt message ${message.id}:`, error);
            message.isLoading = false;
          }
        }
      }
    };

    // Process in batches to avoid blocking
    const batchSize = 5;
    const processBatches = async () => {
      for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize);
        await decryptBatch(batch);
      }
    };

    // Start processing without awaiting
    processBatches().catch(error => {
      console.error('Error in progressive decryption:', error);
    });
  }

  /**
   * Check if we should preload more messages
   */
  private checkPreloadThreshold(conversation: DMConversationCache): void {
    if (conversation.isFullyLoaded || !conversation.hasMoreMessages) {
      return;
    }

    // Check if we're near the bottom of the loaded messages
    const messagesFromBottom = conversation.messages.length;
    if (messagesFromBottom <= this.config.preloadThreshold) {
      // Preload more messages
      this.loadMessagesFromServer(conversation.id, conversation.oldestMessageId);
    }
  }

  /**
   * Trim messages in conversation to prevent memory leaks
   */
  private trimConversationMessages(conversation: DMConversationCache): void {
    if (conversation.messages.length <= this.config.maxMessagesPerConversation) {
      return;
    }

    const messagesToRemove = conversation.messages.length - this.config.maxMessagesPerConversation;
    const removedMessages = conversation.messages.splice(0, messagesToRemove);

    // Clean up global message cache
    removedMessages.forEach(message => {
      this.messageCache.delete(message.id);
    });

    // Update oldest message ID
    if (conversation.messages.length > 0) {
      conversation.oldestMessageId = conversation.messages[0].id;
    }

    this.emit('messagesTrimmed', {
      conversationId: conversation.id,
      removedCount: messagesToRemove,
    });
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    const expiredConversations: string[] = [];

    for (const [id, conversation] of this.conversationCache.entries()) {
      if (now - conversation.lastActivity > this.config.cacheExpirationTime) {
        expiredConversations.push(id);
      }
    }

    expiredConversations.forEach(id => {
      this.conversationCache.delete(id);
    });

    if (expiredConversations.length > 0) {
      this.emit('cacheCleanup', { removedConversations: expiredConversations });
    }
  }

  /**
   * Check if cache entry is expired
   */
  private isCacheExpired(lastActivity: number): boolean {
    return Date.now() - lastActivity > this.config.cacheExpirationTime;
  }

  /**
   * Calculate cache hit rate (mock implementation)
   */
  private calculateCacheHitRate(_conversationId: string): number {
    // This would track actual cache hits/misses
    return 0.85; // Mock 85% hit rate
  }

  /**
   * Search messages on server
   */
  private async searchMessagesOnServer(
    _conversationId: string,
    _query: string
  ): Promise<DMMessageCache[]> {
    // Implementation would search on server
    return [];
  }

  /**
   * Decrypt message (would use DM crypto)
   */
  private async decryptMessage(ciphertext: string, _conversationId: string): Promise<string> {
    // This would use the DM crypto module
    return ciphertext; // Mock
  }

  /**
   * Get auth token
   */
  private async getAuthToken(): Promise<string> {
    // This would get the auth token
    return 'mock-token';
  }

  /**
   * Get current user ID
   */
  private async getCurrentUserId(): Promise<string> {
    // This would get the current user ID
    return 'mock-user-id';
  }
}

// Export for use in the DM manager
(window as any).DMPerformanceOptimizer = DMPerformanceOptimizer;
