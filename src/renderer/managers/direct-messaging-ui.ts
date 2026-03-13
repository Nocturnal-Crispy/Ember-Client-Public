/**
 * Direct Messaging UI Manager — Handles DM sidebar, conversations, and chat interface.
 * Manages the UI components for Direct Messaging functionality.
 */
(function (): void {
  const App = window.App;
  const log = window.emberLog.createLogger("DirectMessagingUI");

  // UI state
  let dmSidebarElement: HTMLElement | null = null;
  let dmChatContainer: HTMLElement | null = null;
  let activeConversationId: string | null = null;
  let conversations = new Map<string, DMConversationUI>();
  let searchTimeout: NodeJS.Timeout | null = null;
  let ownUsername: string = 'Me';
  let dmPendingAttachment: { file: File; name: string } | null = null;
  
  interface DMConversationUI {
    id: string;
    participantId: string;
    participantUsername: string;
    participantAvatar?: string;
    lastMessage?: string;
    unreadCount: number;
    isOnline: boolean;
    keyExchanged: boolean;
    createdAt?: number;
    element?: HTMLElement;
  }
  
  /**
   * Initialize the Direct Messaging UI
   */
  function initializeDirectMessagingUI(): void {
    try {
      log.info("Initializing Direct Messaging UI");

      // Fetch own username for chumhandle display
      window.electronAPI.ipc.invoke('get-auth').then((auth) => {
        const a = auth as { username?: string } | null;
        if (a?.username) ownUsername = a.username;
      }).catch(() => { /* keep default */ });

      // Get existing DM elements from the DOM
      dmSidebarElement = document.querySelector('.dm-sidebar');
      dmChatContainer = document.querySelector('.dm-chat-container');
      
      if (!dmSidebarElement) {
        log.error("DM sidebar element not found in DOM");
        return;
      }
      
      if (!dmChatContainer) {
        log.error("DM chat container element not found in DOM");
        return;
      }
      
      log.debug("DM elements found in DOM", { 
        hasSidebar: !!dmSidebarElement, 
        hasChatContainer: !!dmChatContainer 
      });
      
      // Set up event listeners
      setupEventListeners();
      
      // Initialize enhanced UI features
      initializeEnhancedUI();
      
      // Show search prompt state by default when no conversations exist
      if (conversations.size === 0) {
        showSearchPromptState();
      }
      
      log.info("Direct Messaging UI initialized successfully");
    } catch (error) {
      const err = error as Error;
      log.error("Failed to initialize Direct Messaging UI", { error: err.message });
    }
  }
  
  /**
   * Set up event listeners
   */
  function setupEventListeners(): void {
    if (!dmSidebarElement || !dmChatContainer) return;
    
    // Search input
    const searchInput = dmSidebarElement.querySelector('.dm-search-input') as HTMLInputElement;
    if (searchInput) {
      log.debug("Search input found, adding event listeners");
      searchInput.addEventListener('input', handleUserSearch);
      searchInput.addEventListener('focus', () => showSearchResults());
      searchInput.addEventListener('blur', (e) => {
        // Only hide if the related target (where focus is going) is not within the search results
        const relatedTarget = e.relatedTarget as HTMLElement;
        const resultsContainer = dmSidebarElement?.querySelector('.dm-search-results') as HTMLElement;
        
        if (!relatedTarget || (!resultsContainer?.contains(relatedTarget) && relatedTarget !== searchInput)) {
          setTimeout(hideSearchResults, 100);
        }
      });
      
      // Add keyboard navigation from search input
      searchInput.addEventListener('keydown', (e: Event) => {
        const keyboardEvent = e as KeyboardEvent;
        const resultsContainer = dmSidebarElement?.querySelector('.dm-search-results') as HTMLElement;
        
        if (keyboardEvent.key === 'ArrowDown' && resultsContainer?.style.display === 'block') {
          keyboardEvent.preventDefault();
          const firstResult = resultsContainer.querySelector('.dm-search-result-item') as HTMLElement;
          if (firstResult) {
            firstResult.focus();
          }
        } else if (keyboardEvent.key === 'Escape') {
          keyboardEvent.preventDefault();
          hideSearchResults();
        }
      });
    } else {
      log.error("Search input not found in DM sidebar");
    }
    
    // Message input - with enhanced debugging
    const messageInput = dmChatContainer.querySelector('.message-input') as HTMLTextAreaElement;
    if (messageInput) {
      log.debug("Message input found, setting up event listeners", {
        tagName: messageInput.tagName,
        className: messageInput.className,
        id: messageInput.id,
        disabled: messageInput.disabled,
        readOnly: messageInput.readOnly
      });
      
      // Remove any existing listeners first to prevent duplicates
      messageInput.removeEventListener('input', handleMessageInput);
      messageInput.removeEventListener('keypress', handleMessageKeyPress);
      
      // Add fresh listeners
      messageInput.addEventListener('input', handleMessageInput);
      messageInput.addEventListener('keypress', handleMessageKeyPress);
      
      // Auto-resize textarea
      messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
      });
      
      // Ensure the textarea is interactive
      messageInput.style.pointerEvents = 'auto';
      messageInput.style.userSelect = 'text';
      messageInput.style.webkitUserSelect = 'text';
      
      log.debug("Message input event listeners set up successfully");
    } else {
      log.error("Message input not found in DM chat container");
    }
    
    // GIF button — override window.sendGif to route to this DM conversation
    const gifButton = dmChatContainer.querySelector('#dm-gif-btn') as HTMLButtonElement | null;
    if (gifButton) {
      gifButton.addEventListener('click', (e) => {
        e.stopPropagation();
        window.sendGif = (url: string, title: string): void => {
          if (!activeConversationId) return;
          const payload = JSON.stringify({ t: 'gif', url, title });
          window.sendDirectMessage(activeConversationId, payload).catch((err: Error) => {
            log.error('Failed to send DM GIF', { error: err.message });
          });
        };
        (window as any).openGifPicker(gifButton);
      });
    }

    // Emoji button
    const emojiButton = dmChatContainer.querySelector('#dm-emoji-btn') as HTMLButtonElement | null;
    if (emojiButton && messageInput) {
      emojiButton.addEventListener('click', (e) => {
        e.stopPropagation();
        (window as any).openEmojiPicker(emojiButton, messageInput);
      });
    }
    
    // Attachment button — directly trigger file input (no modal)
    const attachmentFileInput = dmChatContainer.querySelector('#dm-attachment-file-input') as HTMLInputElement | null;
    const attachmentBtn = dmChatContainer.querySelector('#dm-attachment-btn') as HTMLButtonElement | null;
    const attachmentPreviewEl = dmChatContainer.querySelector('#dm-attachment-preview') as HTMLElement | null;
    attachmentBtn?.addEventListener('click', () => {
      attachmentFileInput?.click();
    });
    attachmentFileInput?.addEventListener('change', () => {
      const file = attachmentFileInput.files?.[0];
      if (file) setDmPendingAttachment(file, attachmentPreviewEl);
      attachmentFileInput.value = '';
    });

    // Click outside handler for search results
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const searchInput = dmSidebarElement?.querySelector('.dm-search-input') as HTMLInputElement;
      const resultsContainer = dmSidebarElement?.querySelector('.dm-search-results') as HTMLElement;
      
      if (!searchInput?.contains(target) && !resultsContainer?.contains(target)) {
        hideSearchResults();
      }
    });
  }
  
  /**
   * Handle user search
   */
  async function handleUserSearch(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const query = input.value.trim();
    
    log.debug("User search triggered", { query, queryLength: query.length });
    
    // Clear existing timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }
    
    // Hide results if query is too short
    if (query.length < 2) {
      hideSearchResults();
      return;
    }
    
    // Show loading state and debounce search
    showSearchLoading();
    
    searchTimeout = setTimeout(async () => {
      try {
        log.debug("Calling searchUsers API", { query });
        const users = await searchUsers(query);
        log.debug("Search results received", { query, userCount: users.length });
        
        if (users.length > 0) {
          displaySearchResults(users);
        } else {
          showNoResults(query);
        }
      } catch (error) {
        log.error("User search failed", { query, error });
        hideSearchResults();
      }
    }, 300); // 300ms debounce
  }
  
  /**
   * Search for users via the API
   */
  async function searchUsers(query: string): Promise<User[]> {
    try {
      const auth = await window.getValidAuth();
      if (!auth) {
        log.error("Cannot search users: not authenticated");
        return [];
      }

      log.debug("Making API request", { 
        hostname: auth.hostname, 
        query: query,
        hasToken: !!auth.token 
      });

      const response = await fetch(
        `${auth.hostname}/api/v1/users/search?q=${encodeURIComponent(query)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${auth.token}` },
        }
      );

      log.debug("API response received", { 
        status: response.status,
        statusText: response.statusText,
        ok: response.ok 
      });

      if (!response.ok) {
        log.error("Failed to search users", {
          status: response.status,
          statusText: response.statusText,
          query: query,
        });
        return [];
      }

      const users = await response.json();
      log.info("Users searched successfully", { 
        query, 
        count: users.length,
        users: users.slice(0, 3) // Log first 3 users for debugging
      });
      return users as User[];
    } catch (error) {
      const err = error as Error;
      log.error("Error searching users", { 
        query, 
        error: err.message,
        stack: err.stack 
      });
      return [];
    }
  }
  
  /**
   * Show loading state for search
   */
  function showSearchLoading(): void {
    if (!dmSidebarElement) return;
    
    const resultsContainer = dmSidebarElement.querySelector('.dm-search-results') as HTMLElement;
    if (!resultsContainer) return;
    
    resultsContainer.innerHTML = `
      <div class="dm-search-loading">
        <div class="dm-loading-spinner"></div>
        <div class="dm-loading-text">Searching...</div>
      </div>
    `;

    resultsContainer.style.display = 'block';
    const convList1 = dmSidebarElement.querySelector('.dm-conversation-list') as HTMLElement;
    if (convList1) convList1.style.display = 'none';
  }
  
  /**
   * Show no results message
   */
  function showNoResults(query: string): void {
    if (!dmSidebarElement) return;
    
    const resultsContainer = dmSidebarElement.querySelector('.dm-search-results') as HTMLElement;
    if (!resultsContainer) return;
    
    resultsContainer.innerHTML = `
      <div class="dm-search-no-results">
        <div class="dm-no-results-icon">🔍</div>
        <div class="dm-no-results-text">No users found for "${query}"</div>
      </div>
    `;

    resultsContainer.style.display = 'block';
    const convList2 = dmSidebarElement.querySelector('.dm-conversation-list') as HTMLElement;
    if (convList2) convList2.style.display = 'none';
  }
  
  /**
   * Display search results
   */
  function displaySearchResults(users: User[]): void {
    if (!dmSidebarElement) return;
    
    const resultsContainer = dmSidebarElement.querySelector('.dm-search-results') as HTMLElement;
    if (!resultsContainer) return;
    
    resultsContainer.replaceChildren(
      ...users.map((user) => {
        const item = document.createElement('div');
        item.className = 'dm-search-result-item';
        item.setAttribute('data-user-id', user.id);
        item.setAttribute('data-username', user.username);
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'option');

        const avatarEl = document.createElement('div');
        avatarEl.className = 'dm-search-result-avatar';
        if (user.avatar) {
          const img = document.createElement('img');
          img.src = user.avatar;
          img.alt = user.username;
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
          avatarEl.appendChild(img);
        } else {
          avatarEl.textContent = user.username[0].toUpperCase();
        }

        const nameEl = document.createElement('div');
        nameEl.className = 'dm-search-result-name';
        nameEl.textContent = user.username;

        item.appendChild(avatarEl);
        item.appendChild(nameEl);
        return item;
      })
    );
    
    // Add click handlers
    resultsContainer.querySelectorAll('.dm-search-result-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        // Prevent the search input from losing focus and triggering blur
        e.preventDefault();
      });
      
      item.addEventListener('click', () => {
        const userId = item.getAttribute('data-user-id');
        const username = item.getAttribute('data-username');
        if (userId && username) {
          startDmConversation(userId, username);
          hideSearchResults();
        }
      });
      
      // Add keyboard navigation
      item.addEventListener('keydown', (e: Event) => {
        const keyboardEvent = e as KeyboardEvent;
        if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
          keyboardEvent.preventDefault();
          (item as HTMLElement).click();
        } else if (keyboardEvent.key === 'ArrowDown') {
          keyboardEvent.preventDefault();
          const nextItem = item.nextElementSibling as HTMLElement;
          if (nextItem) nextItem.focus();
        } else if (keyboardEvent.key === 'ArrowUp') {
          keyboardEvent.preventDefault();
          const prevItem = item.previousElementSibling as HTMLElement;
          if (prevItem) {
            prevItem.focus();
          } else {
            // Return focus to search input if at first item
            const searchInput = dmSidebarElement?.querySelector('.dm-search-input') as HTMLInputElement;
            if (searchInput) searchInput.focus();
          }
        } else if (keyboardEvent.key === 'Escape') {
          hideSearchResults();
          const searchInput = dmSidebarElement?.querySelector('.dm-search-input') as HTMLInputElement;
          if (searchInput) searchInput.focus();
        }
      });
    });
    
    resultsContainer.style.display = 'block';
    const convList3 = dmSidebarElement.querySelector('.dm-conversation-list') as HTMLElement;
    if (convList3) convList3.style.display = 'none';

    // Don't auto-focus first result to allow continued typing
    // User can navigate with arrow keys when ready
  }
  
  /**
   * Show search results
   */
  function showSearchResults(): void {
    if (!dmSidebarElement) return;
    const resultsContainer = dmSidebarElement.querySelector('.dm-search-results') as HTMLElement;
    const conversationList = dmSidebarElement.querySelector('.dm-conversation-list') as HTMLElement;
    if (resultsContainer && resultsContainer.children.length > 0) {
      resultsContainer.style.display = 'block';
      if (conversationList) conversationList.style.display = 'none';
    }
  }

  /**
   * Hide search results
   */
  function hideSearchResults(): void {
    if (!dmSidebarElement) return;

    // Clear any pending search timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }

    const resultsContainer = dmSidebarElement.querySelector('.dm-search-results') as HTMLElement;
    const conversationList = dmSidebarElement.querySelector('.dm-conversation-list') as HTMLElement;
    if (resultsContainer) {
      resultsContainer.style.display = 'none';
      resultsContainer.replaceChildren(); // Clear content to prevent stale results
    }
    if (conversationList) conversationList.style.display = '';
  }
  
  /**
   * Start a DM conversation
   */
  async function startDmConversation(userId: string, username: string): Promise<void> {
    try {
      log.info("Starting DM conversation", { userId, username });
      
      // Check if conversation already exists
      const existingConversation = Array.from(conversations.values())
        .find(conv => conv.participantId === userId);
      
      if (existingConversation) {
        setActiveConversation(existingConversation.id);
        return;
      }
      
      // Start conversation via Direct Messaging manager
      // Note: the manager calls window.addDmConversationToList internally, so no need to add here
      if (typeof window.startDmConversation === 'function') {
        const conversationId = await window.startDmConversation(userId, username);
        setActiveConversation(conversationId);
      } else {
        log.error("Direct Messaging manager not available");
      }
    } catch (error) {
      const err = error as Error;
      log.error("Failed to start DM conversation", { userId, username, error: err.message });
    }
  }
  
  /**
   * Add conversation to the sidebar list
   */
  function addConversationToList(conversation: DMConversationUI): void {
    if (!dmSidebarElement) return;
    
    conversations.set(conversation.id, conversation);
    
    const conversationList = dmSidebarElement.querySelector('.dm-conversation-list') as HTMLElement;
    if (!conversationList) return;
    
    // Hide the empty state when first conversation is added
    const emptyState = conversationList.querySelector('.dm-empty-state');
    if (emptyState && conversations.size === 1) {
      emptyState.remove();
    }
    
    const conversationElement = document.createElement('div');
    conversationElement.className = 'dm-conversation-item';
    conversationElement.setAttribute('data-conversation-id', conversation.id);
    const avatarDiv = document.createElement('div');
    avatarDiv.className = `dm-avatar ${conversation.isOnline ? 'online' : 'offline'}`;
    if (conversation.participantAvatar) {
      const img = document.createElement('img');
      img.src = conversation.participantAvatar;
      img.alt = conversation.participantUsername;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      avatarDiv.appendChild(img);
    } else {
      avatarDiv.textContent = conversation.participantUsername[0].toUpperCase();
    }

    const infoDiv = document.createElement('div');
    infoDiv.className = 'dm-conversation-info';
    const nameDiv = document.createElement('div');
    nameDiv.className = 'dm-conversation-name';
    nameDiv.textContent = conversation.participantUsername;
    infoDiv.appendChild(nameDiv);

    conversationElement.appendChild(avatarDiv);
    conversationElement.appendChild(infoDiv);
    if (conversation.unreadCount > 0) {
      const badge = document.createElement('div');
      badge.className = 'dm-unread-count';
      badge.textContent = String(conversation.unreadCount);
      conversationElement.appendChild(badge);
    }
    
    conversationElement.addEventListener('click', () => {
      setActiveConversation(conversation.id);
    });
    
    conversation.element = conversationElement;
    conversationList.appendChild(conversationElement);
  }
  
  /**
   * Remove a conversation from the list
   */
  function removeConversationFromList(conversationId: string): void {
    if (!dmSidebarElement) return;
    
    const conversation = conversations.get(conversationId);
    if (!conversation || !conversation.element) return;
    
    // Remove the conversation element
    conversation.element.remove();
    
    // Remove from conversations map
    conversations.delete(conversationId);
    
    // Show empty state if no conversations left
    if (conversations.size === 0) {
      showEmptyState();
      showSearchPromptState();
    }
  }
  
  /**
   * Show the search prompt state when no conversations exist
   */
  function showSearchPromptState(): void {
    if (!dmChatContainer) return;
    
    // Hide chat header and input areas
    const chatHeader = dmChatContainer.querySelector('.dm-chat-header') as HTMLElement;
    const messagesArea = dmChatContainer.querySelector('.messages-container') as HTMLElement;
    const inputContainer = dmChatContainer.querySelector('.dm-input-container') as HTMLElement;
    const typingIndicator = dmChatContainer.querySelector('.dm-typing-indicator') as HTMLElement;
    const chatEmptyState = dmChatContainer.querySelector('#dm-chat-empty-state') as HTMLElement;
    const searchPromptState = dmChatContainer.querySelector('#dm-search-prompt-state') as HTMLElement;
    
    if (chatHeader) chatHeader.style.display = 'none';
    if (messagesArea) messagesArea.style.display = 'none';
    if (inputContainer) inputContainer.style.display = 'none';
    if (typingIndicator) typingIndicator.style.display = 'none';
    if (chatEmptyState) chatEmptyState.style.display = 'none';
    if (searchPromptState) searchPromptState.style.display = 'flex';
    
    // Add click handler to focus search input
    const focusSearchBtn = searchPromptState?.querySelector('#dm-focus-search-btn');
    if (focusSearchBtn) {
      focusSearchBtn.addEventListener('click', () => {
        const searchInput = dmSidebarElement?.querySelector('.dm-search-input') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      });
    }
  }
  
  /**
   * Show the empty state when no conversations exist
   */
  function showEmptyState(): void {
    if (!dmSidebarElement) return;
    
    const conversationList = dmSidebarElement.querySelector('.dm-conversation-list') as HTMLElement;
    if (!conversationList) return;
    
    // Check if empty state already exists
    const existingEmptyState = conversationList.querySelector('.dm-empty-state');
    if (existingEmptyState) return;
    
    // Create and add empty state
    const emptyState = document.createElement('div');
    emptyState.className = 'dm-empty-state';
    emptyState.innerHTML = `
      <div class="dm-empty-icon">💬</div>
      <div class="dm-empty-title">No Direct Messages</div>
      <div class="dm-empty-text">Start a conversation with someone!</div>
    `;
    
    conversationList.appendChild(emptyState);
  }
  
  /**
   * Load and display messages for a conversation
   */
  async function loadConversationMessages(conversationId: string): Promise<void> {
    try {
      log.info("Loading conversation messages", { conversationId });
      
      // First, ensure key exchange is attempted
      if (typeof window.initiateKeyExchange === 'function') {
        const conversation = conversations.get(conversationId);
        if (conversation && !conversation.keyExchanged) {
          try {
            await window.initiateKeyExchange(conversationId, conversation.participantId);
          } catch (error) {
            log.warn("Failed to initiate key exchange before loading messages", { conversationId, error });
          }
        }
      }
      
      // Fetch messages from the Direct Messaging manager
      if (typeof window.fetchConversationMessages === 'function') {
        const messages = await window.fetchConversationMessages(conversationId);
        
        // Display messages in chronological order (prepend for historical messages)
        messages.forEach((message: any) => {
          displayMessage({
            id: message.id,
            conversationId: message.conversationId,
            senderId: message.senderId,
            content: message.content,
            timestamp: message.timestamp,
            isOwn: message.isOwn
          }, true); // prepend=true for historical messages
        });
        
        log.info("Conversation messages loaded successfully", { conversationId, count: messages.length });
      } else {
        log.error("fetchConversationMessages function not available");
      }
    } catch (error) {
      const err = error as Error;
      log.error("Failed to load conversation messages", { conversationId, error: err.message });
    }
  }

  /**
   * Set active conversation
   */
  function setActiveConversation(conversationId: string): void {
    // Update UI state
    activeConversationId = conversationId;
    
    // Update conversation list active state
    if (dmSidebarElement) {
      dmSidebarElement.querySelectorAll('.dm-conversation-item').forEach(item => {
        item.classList.remove('active');
      });
      
      const activeElement = dmSidebarElement.querySelector(`[data-conversation-id="${conversationId}"]`);
      if (activeElement) {
        activeElement.classList.add('active');
      }
    }
    
    // Update chat container
    updateChatContainer(conversationId);
    
    // Show chat container, hide search prompt and other empty states
    if (dmChatContainer) {
      dmChatContainer.style.display = 'flex';
      
      // Hide search prompt state
      const searchPromptState = dmChatContainer.querySelector('#dm-search-prompt-state') as HTMLElement;
      if (searchPromptState) {
        searchPromptState.style.display = 'none';
      }
      
      // Hide chat empty state
      const chatEmptyState = dmChatContainer.querySelector('#dm-chat-empty-state') as HTMLElement;
      if (chatEmptyState) {
        chatEmptyState.style.display = 'none';
      }
      
      // Show chat components
      const chatHeader = dmChatContainer.querySelector('.dm-chat-header') as HTMLElement;
      const messagesArea = dmChatContainer.querySelector('.messages-container') as HTMLElement;
      const inputContainer = dmChatContainer.querySelector('.dm-input-container') as HTMLElement;
      
      if (chatHeader) chatHeader.style.display = 'flex';
      if (messagesArea) messagesArea.style.display = 'block';
      if (inputContainer) inputContainer.style.display = 'block';
    }
    
    // Fetch and display messages for this conversation
    loadConversationMessages(conversationId);
    
    // Notify Direct Messaging manager
    if (typeof window.setActiveDmConversation === 'function') {
      window.setActiveDmConversation(conversationId);
    }
  }
  
  /**
   * Update chat container with conversation info
   */
  function updateChatContainer(conversationId: string): void {
    if (!dmChatContainer) return;
    
    const conversation = conversations.get(conversationId);
    if (!conversation) return;
    
    // Update header
    const headerName = dmChatContainer.querySelector('.dm-chat-header-name') as HTMLElement;
    const headerAvatar = dmChatContainer.querySelector('.dm-chat-header-avatar') as HTMLElement;
    const headerStatus = dmChatContainer.querySelector('.dm-chat-header-status') as HTMLElement;
    
    if (headerName) headerName.textContent = conversation.participantUsername;
    if (headerAvatar) headerAvatar.textContent = conversation.participantUsername[0].toUpperCase();
    if (headerStatus) headerStatus.textContent = conversation.isOnline ? 'Online' : 'Offline';
    
    // Clear messages and add welcome banner
    const messagesContainer = dmChatContainer.querySelector('.messages-container') as HTMLElement;
    if (messagesContainer) {
      messagesContainer.replaceChildren();
      
      // Add DM welcome banner
      const banner = document.createElement('div');
      banner.className = 'channel-welcome-banner';
      
      const heading = document.createElement('h2');
      heading.className = 'channel-welcome-heading';
      const startTime = conversation.createdAt ? new Date(conversation.createdAt).toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      }) : 'unknown time';
      heading.textContent = `${ownUsername} [${window.toChumhandle(ownUsername)}] began chatting with ${conversation.participantUsername} [${window.toChumhandle(conversation.participantUsername)}] at ${startTime}`;
      
      banner.appendChild(heading);
      messagesContainer.appendChild(banner);
    }
    
    // Reset input and attachment
    const messageInput = dmChatContainer.querySelector('.message-input') as HTMLTextAreaElement;
    if (messageInput) {
      messageInput.value = '';
      messageInput.style.height = 'auto';
    }
    const switchAttachmentPreviewEl = dmChatContainer.querySelector('#dm-attachment-preview') as HTMLElement | null;
    clearDmAttachmentPreview(switchAttachmentPreviewEl);
  }
  
  /**
   * Handle message input
   */
  function handleMessageInput(event: Event): void {
    if (!activeConversationId) return;
    
    const input = event.target as HTMLTextAreaElement;
    const hasContent = input.value.trim().length > 0;
    
    // Send typing indicator
    if (typeof window.sendTypingIndicator === 'function') {
      window.sendTypingIndicator(activeConversationId, hasContent);
    }
  }
  
  /**
   * Handle message input key press
   */
  function handleMessageKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  }
  
  /**
   * Handle sending a message
   */
  async function handleSendMessage(): Promise<void> {
    if (!activeConversationId || !dmChatContainer) return;
    
    const messageInput = dmChatContainer.querySelector('.message-input') as HTMLTextAreaElement;
    if (!messageInput) return;
    
    let content = messageInput.value.trim();
    if (!content && !dmPendingAttachment) return;

    const sendAttachmentPreviewEl = dmChatContainer.querySelector('#dm-attachment-preview') as HTMLElement | null;
    try {
      // Handle DM attachment upload if present
      if (dmPendingAttachment) {
        const auth = (await window.electronAPI.ipc.invoke("get-auth")) as AuthData | null;
        
        if (!auth || !auth.token || !auth.hostname) {
          throw new Error("Authentication required");
        }

        const { file, name } = dmPendingAttachment;
        const arrayBuffer = await file.arrayBuffer();
        const fileBytes = new Uint8Array(arrayBuffer);
        
        // For DM attachments, we need to encrypt with the ember key
        // Get ember key via the DM manager (it maps channel->ember and uses App.emberKeyCache)
        const emberKey = await (async (): Promise<Uint8Array | null> => {
          // Directly call the DM manager's key fetch function if available
          if (typeof (window as any).fetchAndCacheEmberKeyForChannel === 'function') {
            return (window as any).fetchAndCacheEmberKeyForChannel(activeConversationId);
          }
          // Fallback: find emberId via the DM manager's internal map and fetch via ember-key-cache
          if (typeof (window as any).getEmberIdForDmChannel === 'function') {
            const emberId = (window as any).getEmberIdForDmChannel(activeConversationId);
            if (emberId && window.App.emberKeyCache.has(emberId)) {
              return window.App.emberKeyCache.get(emberId) ?? null;
            }
          }
          return null;
        })();
        
        if (!emberKey) {
          throw new Error("Ember key not available for encryption");
        }

        const encryptedBase64 = window.electronAPI.crypto.encryptFileBytes(fileBytes, emberKey);
        const { id } = await window.electronAPI.messageService.uploadAttachment(
          auth, activeConversationId, encryptedBase64, { name, size: file.size, mime: file.type }
        );
        
        // Build file message payload
        const attachmentPayload = JSON.stringify({ 
          t: "file", 
          body: content, 
          a: { id, name, size: file.size, mime: file.type } 
        });
        content = attachmentPayload;
      }

      // Send message via Direct Messaging manager
      if (typeof window.sendDirectMessage === 'function') {
        await window.sendDirectMessage(activeConversationId, content);

        // Clear input and attachment
        messageInput.value = '';
        messageInput.style.height = 'auto';
        clearDmAttachmentPreview(sendAttachmentPreviewEl);

        log.debug("Message sent successfully", { conversationId: activeConversationId });
      } else {
        log.error("Direct Messaging manager not available");
      }
    } catch (error) {
      const err = error as Error;
      log.error("Failed to send message", { conversationId: activeConversationId, error: err.message });
    }
  }
  
  function tryParseMessageContent(content: string): { t: string; url?: string; title?: string; body?: string; a?: AttachmentData } | null {
    try {
      const parsed = JSON.parse(content) as { t?: string; url?: string; title?: string; body?: string; a?: AttachmentData };
      return parsed?.t ? (parsed as { t: string; url?: string; title?: string; body?: string; a?: AttachmentData }) : null;
    } catch {
      return null;
    }
  }

  function setDmPendingAttachment(file: File, previewEl: HTMLElement | null): void {
    const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
    if (file.size === 0 || file.size > MAX_ATTACHMENT_SIZE) return;
    dmPendingAttachment = { file, name: file.name };
    renderDmAttachmentPreview(previewEl);
  }

  function clearDmAttachmentPreview(previewEl: HTMLElement | null): void {
    dmPendingAttachment = null;
    if (!previewEl) return;
    previewEl.classList.add('hidden');
    while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
  }

  function renderDmAttachmentPreview(previewEl: HTMLElement | null): void {
    if (!previewEl || !dmPendingAttachment) return;
    while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
    const icon = document.createElement('span');
    icon.className = 'attachment-preview-icon';
    icon.textContent = '📎 ';
    const nameEl = document.createElement('span');
    nameEl.className = 'attachment-preview-name';
    nameEl.textContent = dmPendingAttachment.name;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'attachment-preview-remove';
    removeBtn.title = 'Remove attachment';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => clearDmAttachmentPreview(previewEl));
    previewEl.appendChild(icon);
    previewEl.appendChild(nameEl);
    previewEl.appendChild(removeBtn);
    previewEl.classList.remove('hidden');
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Display a new message in the chat
   */
  function displayMessage(messageData: {
    id: string;
    conversationId: string;
    senderId: string;
    content: string;
    timestamp: number;
    isOwn: boolean;
    chatColor?: string;
  }, prepend = false): void {
    if (!dmChatContainer || messageData.conversationId !== activeConversationId) return;

    const messagesContainer = dmChatContainer.querySelector('.messages-container') as HTMLElement;
    if (!messagesContainer) return;

    const conversation = conversations.get(messageData.conversationId);
    const senderName = messageData.isOwn
      ? ownUsername
      : (conversation?.participantUsername || 'User');

    const parsedContent = tryParseMessageContent(messageData.content);
    let text = messageData.content;
    let attachment: AttachmentData | undefined;
    let gif: { url: string; title?: string } | undefined;
    if (parsedContent?.t === 'file' && parsedContent.a) {
      text = parsedContent.body ?? '';
      attachment = parsedContent.a as AttachmentData;
    } else if (parsedContent?.t === 'gif' && parsedContent.url) {
      text = '';
      gif = { url: parsedContent.url, title: parsedContent.title };
    }

    const getEmberKey = (cid: string): Promise<Uint8Array | null> =>
      (window as any).fetchAndCacheEmberKeyForChannel(cid) as Promise<Uint8Array | null>;

    const messageElement = window.createBasicMessageElement(
      senderName,
      text,
      messageData.timestamp,
      messageData.id,
      messageData.chatColor,
      messageData.isOwn,
      attachment,
      gif,
      messageData.conversationId,
      getEmberKey
    );

    if (prepend) {
      const banner = messagesContainer.querySelector('.channel-welcome-banner');
      const referenceNode = banner ? banner.nextSibling : messagesContainer.firstChild;
      if (referenceNode) {
        messagesContainer.insertBefore(messageElement, referenceNode);
      } else {
        messagesContainer.appendChild(messageElement);
      }
    } else {
      messagesContainer.appendChild(messageElement);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }
  
  /**
   * Format message timestamp
   */
  function formatMessageTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  }
  
  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  /**
   * Update conversation in list
   */
  function updateConversation(conversationId: string, updates: Partial<DMConversationUI>): void {
    const conversation = conversations.get(conversationId);
    if (!conversation || !conversation.element) return;
    
    Object.assign(conversation, updates);
    
    // Update UI element
    const nameElement = conversation.element.querySelector('.dm-conversation-name') as HTMLElement;
    const lastMessageElement = conversation.element.querySelector('.dm-conversation-last-message') as HTMLElement;
    const unreadElement = conversation.element.querySelector('.dm-unread-count, .dm-unread-indicator') as HTMLElement;
    const avatarElement = conversation.element.querySelector('.dm-avatar') as HTMLElement;
    
    if (nameElement) nameElement.textContent = conversation.participantUsername;
    
    // Update avatar online status
    if (avatarElement) {
      if (conversation.isOnline) {
        avatarElement.classList.add('online');
        avatarElement.classList.remove('offline');
      } else {
        avatarElement.classList.add('offline');
        avatarElement.classList.remove('online');
      }
    }
    
    // Update unread indicator
    if (unreadElement) {
      if (conversation.unreadCount > 0) {
        unreadElement.className = 'dm-unread-count';
        unreadElement.textContent = conversation.unreadCount.toString();
      } else if (conversation.unreadCount === 1) {
        unreadElement.className = 'dm-unread-indicator';
        unreadElement.textContent = '';
      } else {
        unreadElement.remove();
      }
    }
  }
  
  /**
   * Show/hide typing indicator
   */
  function showTypingIndicator(isTyping: boolean, username?: string): void {
    if (!dmChatContainer) return;
    
    const typingIndicator = dmChatContainer.querySelector('.dm-typing-indicator') as HTMLElement;
    if (!typingIndicator) return;
    
    if (isTyping && username) {
      typingIndicator.innerHTML = `${username} is typing<span>.</span><span>.</span><span>.</span>`;
      typingIndicator.style.display = 'block';
    } else {
      typingIndicator.style.display = 'none';
    }
  }
  
  /**
   * Add message reactions to a message
   */
  function addMessageReactions(messageId: string, reactions: MessageReaction[]): void {
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement;
    if (!messageElement) return;
    
    let reactionsContainer = messageElement.querySelector('.dm-message-reactions') as HTMLElement;
    if (!reactionsContainer) {
      reactionsContainer = document.createElement('div');
      reactionsContainer.className = 'dm-message-reactions';
      messageElement.appendChild(reactionsContainer);
    }
    
    reactionsContainer.innerHTML = reactions.map(reaction => `
      <div class="dm-reaction ${reaction.reacted ? 'reacted' : ''}" data-reaction="${reaction.emoji}">
        ${reaction.emoji} ${reaction.count}
      </div>
    `).join('');
    
    // Add click handlers for reactions
    reactionsContainer.querySelectorAll('.dm-reaction').forEach(element => {
      element.addEventListener('click', () => {
        const emoji = element.getAttribute('data-reaction');
        if (emoji) {
          toggleReaction(messageId, emoji);
        }
      });
    });
  }
  
  interface MessageReaction {
    emoji: string;
    count: number;
    reacted: boolean;
  }
  
  /**
   * Toggle a reaction on a message
   */
  function toggleReaction(messageId: string, emoji: string): void {
    // This would send the reaction to the server
    log.info('Toggling reaction', { messageId, emoji });
    
    // Add visual feedback
    const reactionElement = document.querySelector(`[data-message-id="${messageId}"] .dm-reaction[data-reaction="${emoji}"]`) as HTMLElement;
    if (reactionElement) {
      reactionElement.style.transform = 'scale(1.2)';
      setTimeout(() => {
        reactionElement.style.transform = 'scale(1)';
      }, 200);
    }
  }
  
  /**
   * Update message status indicator
   */
  function updateMessageStatus(messageId: string, status: 'sending' | 'sent' | 'delivered' | 'read'): void {
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement;
    if (!messageElement) return;
    
    let statusElement = messageElement.querySelector('.dm-message-status') as HTMLElement;
    if (!statusElement) {
      statusElement = document.createElement('div');
      statusElement.className = 'dm-message-status';
      const messageContent = messageElement.querySelector('.message-content');
      if (messageContent) {
        messageContent.appendChild(statusElement);
      }
    }
    
    statusElement.className = `dm-message-status ${status}`;
    
    const statusIcons = {
      sending: '⏳',
      sent: '✓',
      delivered: '✓✓',
      read: '✓✓'
    };
    
    statusElement.innerHTML = statusIcons[status] || '';
  }
  
  /**
   * Show context menu for messages or conversations
   */
  function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
    // Remove existing context menu
    const existingMenu = document.querySelector('.dm-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }
    
    const menu = document.createElement('div');
    menu.className = 'dm-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    
    menu.innerHTML = items.map(item => `
      <div class="dm-context-menu-item ${item.danger ? 'danger' : ''}" data-action="${item.action}">
        <span>${item.icon}</span>
        <span>${item.label}</span>
      </div>
      ${item.separator ? '<div class="dm-context-menu-separator"></div>' : ''}
    `).join('');
    
    document.body.appendChild(menu);
    
    // Add click handlers
    menu.querySelectorAll('.dm-context-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.getAttribute('data-action');
        if (action) {
          const menuItem = items.find(i => i.action === action);
          if (menuItem?.callback) {
            menuItem.callback();
          }
        }
        menu.remove();
      });
    });
    
    // Close menu when clicking outside
    setTimeout(() => {
      document.addEventListener('click', function closeMenu() {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      });
    }, 100);
  }
  
  interface ContextMenuItem {
    action: string;
    label: string;
    icon: string;
    danger?: boolean;
    separator?: boolean;
    callback?: () => void;
  }
  
  /**
   * Enhanced search with loading state
   */
  function enhanceSearchInput(): void {
    if (!dmSidebarElement) return;
    
    const searchInput = dmSidebarElement.querySelector('.dm-search-input') as HTMLInputElement;
    if (!searchInput) return;
    
    let searchTimeout: NodeJS.Timeout;
    
    searchInput.addEventListener('input', () => {
      // Show loading state
      searchInput.classList.add('loading');
      
      // Clear existing timeout
      clearTimeout(searchTimeout);
      
      // Simulate search delay
      searchTimeout = setTimeout(() => {
        searchInput.classList.remove('loading');
      }, 500);
    });
  }
  
  /**
   * Add notification badges
   */
  function addNotificationBadge(element: HTMLElement, count: number): void {
    const existingBadge = element.querySelector('.dm-notification-badge');
    if (existingBadge) {
      if (count > 0) {
        existingBadge.textContent = count > 99 ? '99+' : count.toString();
      } else {
        existingBadge.remove();
      }
      return;
    }
    
    if (count > 0) {
      const badge = document.createElement('div');
      badge.className = 'dm-notification-badge';
      badge.textContent = count > 99 ? '99+' : count.toString();
      element.style.position = 'relative';
      element.appendChild(badge);
    }
  }
  
  /**
   * Initialize enhanced UI features
   */
  function initializeEnhancedUI(): void {
    enhanceSearchInput();
    
    // Add context menu support
    document.addEventListener('contextmenu', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.dm-message') || target.closest('.dm-conversation-item')) {
        e.preventDefault();
        
        const items: ContextMenuItem[] = [
          { action: 'reply', label: 'Reply', icon: '↩️' },
          { action: 'edit', label: 'Edit', icon: '✏️' },
          { action: 'delete', label: 'Delete', icon: '🗑️', danger: true, separator: true },
          { action: 'copy', label: 'Copy', icon: '📋' }
        ];
        
        showContextMenu(e.clientX, e.clientY, items);
      }
    });
    
    // Initialize accessibility features
    initializeAccessibility();
  }
  
  /**
   * Initialize accessibility features
   */
  function initializeAccessibility(): void {
    // Set up keyboard navigation
    setupKeyboardNavigation();
    
    // Add ARIA labels and live regions
    setupAriaLabels();
    
    // Set up focus management
    setupFocusManagement();
    
    log.info('Accessibility features initialized');
  }
  
  /**
   * Set up keyboard navigation
   */
  function setupKeyboardNavigation(): void {
    if (!dmSidebarElement || !dmChatContainer) return;
    
    // Add keyboard navigation to conversation list
    const conversationList = dmSidebarElement.querySelector('.dm-conversation-list') as HTMLElement;
    if (conversationList) {
      conversationList.setAttribute('role', 'navigation');
      conversationList.setAttribute('aria-label', 'Direct conversations');
      
      // Make conversation items focusable and add keyboard hints
      const conversationItems = conversationList.querySelectorAll('.dm-conversation-item');
      conversationItems.forEach((item, index) => {
        const element = item as HTMLElement;
        element.setAttribute('tabindex', '0');
        element.setAttribute('role', 'button');
        element.setAttribute('aria-label', `Conversation ${index + 1}`);
        
        // Add keyboard hint
        const hint = document.createElement('div');
        hint.className = 'dm-keyboard-hint';
        hint.textContent = 'Press Enter to open';
        element.appendChild(hint);
        
        // Add keyboard event listeners
        element.addEventListener('keydown', (e) => handleConversationKeydown(e, element));
      });
    }
    
    // Add drag-and-drop support
    const messagesContainer = dmChatContainer.querySelector('.messages-container') as HTMLElement;
    if (messagesContainer) {
      messagesContainer.setAttribute('role', 'log');
      messagesContainer.setAttribute('aria-live', 'polite');
      messagesContainer.setAttribute('aria-label', 'Messages');
      
      // Drag-and-drop files onto DM messages
      messagesContainer.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault();
        messagesContainer.classList.add('drag-over');
      });
      messagesContainer.addEventListener('dragleave', (e: DragEvent) => {
        if (!messagesContainer.contains(e.relatedTarget as Node)) {
          messagesContainer.classList.remove('drag-over');
        }
      });
      messagesContainer.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault();
        messagesContainer.classList.remove('drag-over');
        const file = e.dataTransfer?.files[0];
        if (file) {
          dmPendingAttachment = { file, name: file.name };
          // Show attachment preview
          const sendAttachmentPreviewEl = dmChatContainer?.querySelector('#dm-attachment-preview') as HTMLElement | null;
          if (sendAttachmentPreviewEl) {
            sendAttachmentPreviewEl.style.display = 'flex';
            const fileNameEl = sendAttachmentPreviewEl.querySelector('.attachment-filename') as HTMLElement;
            if (fileNameEl) fileNameEl.textContent = file.name;
          }
        }
      });
      
      // Make messages focusable
      const messages = messagesContainer.querySelectorAll('.dm-message');
      messages.forEach((message, index) => {
        const element = message as HTMLElement;
        element.setAttribute('tabindex', '-1'); // Initially not focusable
        element.setAttribute('role', 'article');
        element.setAttribute('aria-label', `Message ${index + 1}`);
        
        // Add keyboard event listeners
        element.addEventListener('keydown', (e) => handleMessageKeydown(e, element));
      });
    }
    
    // Add keyboard navigation to input
    const inputField = dmChatContainer.querySelector('.message-input') as HTMLTextAreaElement;
    if (inputField) {
      inputField.setAttribute('aria-label', 'Type a message');
      
      // The help text is now in the placeholder, so no need for additional help element
    }
  }
  
  /**
   * Handle keyboard events for conversation items
   */
  function handleConversationKeydown(event: KeyboardEvent, element: HTMLElement): void {
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        element.click();
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusNextElement(element, '.dm-conversation-item');
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusPreviousElement(element, '.dm-conversation-item');
        break;
      case 'Home':
        event.preventDefault();
        focusFirstElement('.dm-conversation-item');
        break;
      case 'End':
        event.preventDefault();
        focusLastElement('.dm-conversation-item');
        break;
    }
  }
  
  /**
   * Handle keyboard events for messages
   */
  function handleMessageKeydown(event: KeyboardEvent, element: HTMLElement): void {
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        // Focus the input field to reply
        const inputField = dmChatContainer?.querySelector('.message-input') as HTMLTextAreaElement;
        if (inputField) {
          inputField.focus();
        }
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusNextElement(element, '.dm-message');
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusPreviousElement(element, '.dm-message');
        break;
      case 'Home':
        event.preventDefault();
        focusFirstElement('.dm-message');
        break;
      case 'End':
        event.preventDefault();
        focusLastElement('.dm-message');
        break;
    }
  }
  
  /**
   * Focus the next element in a list
   */
  function focusNextElement(currentElement: HTMLElement, selector: string): void {
    const elements = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
    const currentIndex = elements.indexOf(currentElement);
    
    if (currentIndex < elements.length - 1) {
      elements[currentIndex + 1].focus();
    }
  }
  
  /**
   * Focus the previous element in a list
   */
  function focusPreviousElement(currentElement: HTMLElement, selector: string): void {
    const elements = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
    const currentIndex = elements.indexOf(currentElement);
    
    if (currentIndex > 0) {
      elements[currentIndex - 1].focus();
    }
  }
  
  /**
   * Focus the first element in a list
   */
  function focusFirstElement(selector: string): void {
    const firstElement = document.querySelector(selector) as HTMLElement;
    if (firstElement) {
      firstElement.focus();
    }
  }
  
  /**
   * Focus the last element in a list
   */
  function focusLastElement(selector: string): void {
    const elements = document.querySelectorAll(selector) as NodeListOf<HTMLElement>;
    if (elements.length > 0) {
      elements[elements.length - 1].focus();
    }
  }
  
  /**
   * Set up ARIA labels and live regions
   */
  function setupAriaLabels(): void {
    // Create live regions for screen reader announcements
    const liveRegions = document.createElement('div');
    liveRegions.innerHTML = `
      <div class="dm-live-region polite" aria-live="polite" aria-atomic="true"></div>
      <div class="dm-live-region assertive" aria-live="assertive" aria-atomic="true"></div>
      <div class="dm-status-indicator" aria-live="polite"></div>
    `;
    document.body.appendChild(liveRegions);
    
    // Add ARIA labels to chat actions
    const chatActions = dmChatContainer?.querySelectorAll('.dm-chat-action-btn');
    chatActions?.forEach((btn, index) => {
      const button = btn as HTMLElement;
      const titles = ['Voice call', 'Video call', 'More options'];
      button.setAttribute('aria-label', titles[index] || 'Action');
      button.setAttribute('title', titles[index] || 'Action');
    });
  }
  
  /**
   * Set up focus management
   */
  function setupFocusManagement(): void {
    // Trap focus within modal dialogs
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const modal = document.querySelector('.dm-context-menu') as HTMLElement;
        if (modal && modal.style.display !== 'none') {
          trapFocus(e, modal);
        }
      }
    });
    
    // Add focus indicators
    document.addEventListener('focusin', (e) => {
      const target = e.target as HTMLElement;
      if (target.matches('.dm-conversation-item, .dm-message, .message-input, .dm-search-input')) {
        addFocusIndicator(target);
      }
    });
    
    document.addEventListener('focusout', (e) => {
      const target = e.target as HTMLElement;
      removeFocusIndicator(target);
    });
  }
  
  /**
   * Trap focus within a container
   */
  function trapFocus(event: KeyboardEvent, container: HTMLElement): void {
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    ) as NodeListOf<HTMLElement>;
    
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    if (event.shiftKey) {
      if (document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }
  }
  
  /**
   * Add focus indicator to an element
   */
  function addFocusIndicator(element: HTMLElement): void {
    // Remove existing indicators
    removeFocusIndicator(element);
    
    const indicator = document.createElement('div');
    indicator.className = 'dm-focus-indicator active';
    
    // Copy border radius from element
    const computedStyle = window.getComputedStyle(element);
    indicator.style.borderRadius = computedStyle.borderRadius;
    
    element.style.position = 'relative';
    element.appendChild(indicator);
  }
  
  /**
   * Remove focus indicator from an element
   */
  function removeFocusIndicator(element: HTMLElement): void {
    const indicator = element.querySelector('.dm-focus-indicator');
    if (indicator) {
      indicator.remove();
    }
  }
  
  /**
   * Announce message to screen readers
   */
  function announceToScreenReader(message: string): void {
    const liveRegion = document.querySelector('.dm-live-region.polite') as HTMLElement;
    if (liveRegion) {
      liveRegion.textContent = message;
      
      // Clear after announcement
      setTimeout(() => {
        liveRegion.textContent = '';
      }, 1000);
    }
  }
  
  /**
   * Update screen reader with status changes
   */
  function updateScreenReaderStatus(status: string): void {
    const statusIndicator = document.querySelector('.dm-status-indicator') as HTMLElement;
    if (statusIndicator) {
      statusIndicator.textContent = status;
    }
  }
  
  // Expose functions to global scope
  window.initializeDirectMessagingUI = initializeDirectMessagingUI;
  window.displayDmMessage = displayMessage;
  window.updateDmConversation = updateConversation;
  window.showDmTypingIndicator = showTypingIndicator;
  window.addDmMessageReactions = addMessageReactions;
  window.updateDmMessageStatus = updateMessageStatus;
  window.addDmNotificationBadge = addNotificationBadge;
  window.removeDmConversation = removeConversationFromList;
  
  // Accessibility functions
  window.announceToScreenReader = announceToScreenReader;
  window.updateScreenReaderStatus = updateScreenReaderStatus;
  window.initializeAccessibility = initializeAccessibility;
  
  // Test functions for debugging
  window.testDmMessageSend = testDmMessageSend;
  window.debugTextarea = debugTextarea;
  
  /**
   * Debug function to test textarea functionality
   * Can be called from browser console: window.debugTextarea()
   */
  function debugTextarea(): void {
    try {
      log.info("Debugging textarea functionality");
      
      const textarea = dmChatContainer?.querySelector('.message-input') as HTMLTextAreaElement;
      
      if (!textarea) {
        log.error("Textarea not found");
        console.error("Textarea not found in DOM");
        return;
      }
      
      log.info("Textarea found", {
        tagName: textarea.tagName,
        className: textarea.className,
        id: textarea.id,
        disabled: textarea.disabled,
        readOnly: textarea.readOnly,
        style: textarea.style.cssText,
        computedDisplay: getComputedStyle(textarea).display,
        computedVisibility: getComputedStyle(textarea).visibility,
        computedZIndex: getComputedStyle(textarea).zIndex,
        computedPointerEvents: getComputedStyle(textarea).pointerEvents,
        computedUserSelect: getComputedStyle(textarea).userSelect,
        hasAttributeDisabled: textarea.hasAttribute('disabled'),
        hasAttributeReadonly: textarea.hasAttribute('readonly'),
        maxLength: textarea.maxLength,
        rows: textarea.rows,
        value: textarea.value,
        placeholder: textarea.placeholder
      });
      
      // Test if we can focus it
      log.info("Attempting to focus textarea");
      textarea.focus();
      
      // Test if we can input text
      log.info("Attempting to set test value");
      textarea.value = "Test message";
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Check event listeners
      log.info("Textarea has event listeners:", {
        hasInputListener: !!textarea.oninput,
        hasKeyPressListener: !!textarea.onkeypress,
        hasKeyDownListener: !!textarea.onkeydown,
        hasKeyUpListener: !!textarea.onkeyup,
        hasFocusListener: !!textarea.onfocus,
        hasBlurListener: !!textarea.onblur
      });
      
      // Test direct input
      setTimeout(() => {
        log.info("Testing direct character input");
        textarea.value += " - Additional text";
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        log.info("Textarea value after test:", { value: textarea.value });
      }, 100);
      
    } catch (error) {
      const err = error as Error;
      log.error("Textarea debug failed", { error: err.message, stack: err.stack });
    }
  }
  
  /**
   * Test function for DM message sending
   * Can be called from browser console: window.testDmMessageSend()
   */
  async function testDmMessageSend(): Promise<void> {
    try {
      log.info("Testing DM message send functionality");
      
      // Check if required functions are available
      if (!window.sendDirectMessage) {
        log.error("sendDirectMessage function not available");
        return;
      }
      
      if (!activeConversationId) {
        log.error("No active DM conversation - please start a DM first");
        return;
      }
      
      // Create a test message
      const testMessage = `Test message sent at ${new Date().toLocaleTimeString()}`;
      
      log.info("Sending test DM message", { 
        conversationId: activeConversationId, 
        message: testMessage 
      });
      
      // Send the message
      const messageId = await window.sendDirectMessage(activeConversationId, testMessage);
      
      log.info("Test DM message sent successfully", { 
        messageId,
        conversationId: activeConversationId 
      });
      
      // Show success notification
      if (typeof window.announceToScreenReader === 'function') {
        window.announceToScreenReader("Test message sent successfully");
      }
      
    } catch (error) {
      const err = error as Error;
      log.error("Test DM message send failed", { error: err.message });
      
      // Show error notification
      if (typeof window.announceToScreenReader === 'function') {
        window.announceToScreenReader("Failed to send test message");
      }
    }
  }
  
  // Expose functions to global scope
  window.addDmConversationToList = addConversationToList;
  window.initializeDirectMessagingUI = initializeDirectMessagingUI;
})();
