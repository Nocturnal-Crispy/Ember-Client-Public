/**
 * Direct Messaging Accessibility Enhancer
 * Provides keyboard navigation, ARIA support, and screen reader enhancements
 */

class DMAccessibilityEnhancer {
  private currentFocusIndex = -1;
  private focusableElements: HTMLElement[] = [];
  private isKeyboardNavigation = false;
  private liveRegion: HTMLElement | null = null;
  private announcer: HTMLElement | null = null;

  constructor() {
    this.initializeAccessibility();
  }

  /**
   * Initialize accessibility features
   */
  private initializeAccessibility(): void {
    this.createLiveRegions();
    this.setupKeyboardNavigation();
    this.setupAriaAttributes();
    this.setupFocusManagement();
    this.setupScreenReaderSupport();
  }

  /**
   * Create live regions for screen readers
   */
  private createLiveRegions(): void {
    // Create status live region
    this.liveRegion = document.createElement('div');
    this.liveRegion.setAttribute('aria-live', 'polite');
    this.liveRegion.setAttribute('aria-atomic', 'true');
    this.liveRegion.className = 'sr-only dm-live-region';
    document.body.appendChild(this.liveRegion);

    // Create announcer for important changes
    this.announcer = document.createElement('div');
    this.announcer.setAttribute('aria-live', 'assertive');
    this.announcer.setAttribute('aria-atomic', 'true');
    this.announcer.className = 'sr-only dm-announcer';
    document.body.appendChild(this.announcer);
  }

  /**
   * Setup keyboard navigation
   */
  private setupKeyboardNavigation(): void {
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    document.addEventListener('mousedown', this.handleMouseDown.bind(this));
  }

  /**
   * Handle keyboard navigation
   */
  private handleKeyDown(event: KeyboardEvent): void {
    // Mark that we're using keyboard navigation
    this.isKeyboardNavigation = true;

    const dmContainer = document.querySelector('.dm-sidebar, .dm-chat-container');
    if (!dmContainer) return;

    // Update focusable elements list
    this.updateFocusableElements(dmContainer as HTMLElement);

    switch (event.key) {
      case 'Tab':
        this.handleTabNavigation(event);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        this.handleArrowNavigation(event);
        break;
      case 'Enter':
      case ' ':
        this.handleActivation(event);
        break;
      case 'Escape':
        this.handleEscape(event);
        break;
      case '/':
        this.handleSearchShortcut(event);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        this.handleHorizontalNavigation(event);
        break;
    }
  }

  /**
   * Handle mouse down to detect keyboard vs mouse navigation
   */
  private handleMouseDown(): void {
    this.isKeyboardNavigation = false;
  }

  /**
   * Update list of focusable elements
   */
  private updateFocusableElements(container: HTMLElement): void {
    this.focusableElements = Array.from(
      container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ) as HTMLElement[];

    // Filter out elements that are not visible or disabled
    this.focusableElements = this.focusableElements.filter(el => {
      const style = window.getComputedStyle(el);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        !el.hasAttribute('disabled') &&
        el.tabIndex >= 0
      );
    });
  }

  /**
   * Handle Tab navigation
   */
  private handleTabNavigation(event: KeyboardEvent): void {
    if (this.focusableElements.length === 0) return;

    const currentIndex = this.focusableElements.indexOf(document.activeElement as HTMLElement);
    let nextIndex = currentIndex;

    if (event.shiftKey) {
      // Shift+Tab - go backwards
      nextIndex = currentIndex <= 0 ? this.focusableElements.length - 1 : currentIndex - 1;
    } else {
      // Tab - go forwards
      nextIndex = currentIndex >= this.focusableElements.length - 1 ? 0 : currentIndex + 1;
    }

    if (nextIndex !== currentIndex) {
      event.preventDefault();
      this.focusElement(this.focusableElements[nextIndex]);
    }
  }

  /**
   * Handle arrow key navigation
   */
  private handleArrowNavigation(event: KeyboardEvent): void {
    if (this.focusableElements.length === 0) return;

    const currentElement = document.activeElement as HTMLElement;
    const isConversationList = currentElement.closest('.dm-conversation-list');
    const isMessageList = currentElement.closest('.dm-messages');

    if (isConversationList) {
      this.navigateConversationList(event.key === 'ArrowUp' ? -1 : 1);
      event.preventDefault();
    } else if (isMessageList) {
      this.navigateMessageList(event.key === 'ArrowUp' ? -1 : 1);
      event.preventDefault();
    }
  }

  /**
   * Navigate conversation list
   */
  private navigateConversationList(direction: number): void {
    const conversations = Array.from(
      document.querySelectorAll('.dm-conversation-item')
    ) as HTMLElement[];
    const current = document.activeElement as HTMLElement;
    const currentIndex = conversations.indexOf(current);

    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = conversations.length - 1;
    if (nextIndex >= conversations.length) nextIndex = 0;

    if (conversations[nextIndex]) {
      this.focusElement(conversations[nextIndex]);
      this.announceConversationChange(
        conversations[nextIndex],
        nextIndex + 1,
        conversations.length
      );
    }
  }

  /**
   * Navigate message list
   */
  private navigateMessageList(direction: number): void {
    const messages = Array.from(document.querySelectorAll('.dm-message')) as HTMLElement[];
    const current = document.activeElement as HTMLElement;
    const currentIndex = messages.indexOf(current);

    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = messages.length - 1;
    if (nextIndex >= messages.length) nextIndex = 0;

    if (messages[nextIndex]) {
      this.focusElement(messages[nextIndex]);
      this.announceMessageChange(messages[nextIndex], nextIndex + 1, messages.length);
    }
  }

  /**
   * Handle horizontal navigation
   */
  private handleHorizontalNavigation(event: KeyboardEvent): void {
    const currentElement = document.activeElement as HTMLElement;
    const isSearchInput = currentElement.classList.contains('dm-search-input');

    if (isSearchInput) {
      // Let default behavior handle text input navigation
      return;
    }

    // Navigate between sidebar and chat area
    const sidebar = document.querySelector('.dm-sidebar') as HTMLElement;
    const chatArea = document.querySelector('.dm-chat-container') as HTMLElement;

    if (event.key === 'ArrowLeft' && chatArea?.contains(currentElement)) {
      // Move to sidebar
      const firstFocusable = sidebar?.querySelector(
        '.dm-conversation-item, .dm-search-input'
      ) as HTMLElement;
      if (firstFocusable) {
        event.preventDefault();
        this.focusElement(firstFocusable);
        this.announce('Moved to conversation list');
      }
    } else if (event.key === 'ArrowRight' && sidebar?.contains(currentElement)) {
      // Move to chat area
      const firstFocusable = chatArea?.querySelector(
        '.dm-input-field, .dm-chat-action-btn'
      ) as HTMLElement;
      if (firstFocusable) {
        event.preventDefault();
        this.focusElement(firstFocusable);
        this.announce('Moved to chat area');
      }
    }
  }

  /**
   * Handle activation (Enter/Space)
   */
  private handleActivation(event: KeyboardEvent): void {
    const currentElement = document.activeElement as HTMLElement;

    if (currentElement.classList.contains('dm-conversation-item')) {
      event.preventDefault();
      currentElement.click();
      this.announce('Conversation selected');
    } else if (currentElement.classList.contains('dm-chat-action-btn')) {
      event.preventDefault();
      currentElement.click();
    } else if (currentElement.classList.contains('dm-input-btn')) {
      event.preventDefault();
      currentElement.click();
    }
  }

  /**
   * Handle Escape key
   */
  private handleEscape(_event: KeyboardEvent): void {
    // Close modals, dropdowns, or return focus to main content
    const searchResults = document.querySelector('.dm-search-results') as HTMLElement;
    if (searchResults && searchResults.style.display !== 'none') {
      searchResults.style.display = 'none';
      this.announce('Search results closed');
    } else {
      // Return focus to conversation list or input
      const conversationList = document.querySelector('.dm-conversation-list');
      const firstConversation = conversationList?.querySelector(
        '.dm-conversation-item'
      ) as HTMLElement;
      if (firstConversation) {
        this.focusElement(firstConversation);
        this.announce('Returned to conversation list');
      }
    }
  }

  /**
   * Handle search shortcut
   */
  private handleSearchShortcut(event: KeyboardEvent): void {
    const currentElement = document.activeElement as HTMLElement;

    // Don't trigger if already in an input field
    if (currentElement.tagName === 'INPUT' || currentElement.tagName === 'TEXTAREA') {
      return;
    }

    const searchInput = document.querySelector('.dm-search-input') as HTMLElement;
    if (searchInput) {
      event.preventDefault();
      this.focusElement(searchInput);
      this.announce('Search activated');
    }
  }

  /**
   * Setup ARIA attributes
   */
  private setupAriaAttributes(): void {
    this.enhanceConversationList();
    this.enhanceMessageList();
    this.enhanceInputArea();
    this.enhanceSearchArea();
  }

  /**
   * Enhance conversation list with ARIA attributes
   */
  private enhanceConversationList(): void {
    const conversationList = document.querySelector('.dm-conversation-list');
    if (conversationList) {
      conversationList.setAttribute('role', 'list');
      conversationList.setAttribute('aria-label', 'Direct message conversations');
    }

    document.querySelectorAll('.dm-conversation-item').forEach((item, index) => {
      const element = item as HTMLElement;
      element.setAttribute('role', 'listitem');
      element.setAttribute(
        'aria-setsize',
        document.querySelectorAll('.dm-conversation-item').length.toString()
      );
      element.setAttribute('aria-posinset', (index + 1).toString());

      const name = element.querySelector('.dm-conversation-name');
      const lastMessage = element.querySelector('.dm-conversation-last-message');
      const unreadCount = element.querySelector('.dm-unread-count');

      let label = name?.textContent || '';
      if (lastMessage?.textContent) {
        label += `, Last message: ${lastMessage.textContent}`;
      }
      if (unreadCount?.textContent) {
        label += `, ${unreadCount.textContent} unread messages`;
      }

      element.setAttribute('aria-label', label);

      if (unreadCount) {
        element.setAttribute('aria-describedby', `unread-${index}`);
        unreadCount.id = `unread-${index}`;
      }
    });
  }

  /**
   * Enhance message list with ARIA attributes
   */
  private enhanceMessageList(): void {
    const messageList = document.querySelector('.dm-messages');
    if (messageList) {
      messageList.setAttribute('role', 'log');
      messageList.setAttribute('aria-live', 'polite');
      messageList.setAttribute('aria-label', 'Conversation messages');
    }

    document.querySelectorAll('.dm-message').forEach((message, _index) => {
      const element = message as HTMLElement;
      element.setAttribute('role', 'article');

      const sender = element.querySelector('.dm-message-name')?.textContent;
      const content = element.querySelector('.dm-message-text')?.textContent;
      const time = element.querySelector('.dm-message-time')?.textContent;

      let label = 'Message from ';
      if (element.classList.contains('own')) {
        label += 'you';
      } else if (sender) {
        label += sender;
      }

      if (time) {
        label += ` at ${time}`;
      }

      if (content) {
        label += `: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`;
      }

      element.setAttribute('aria-label', label);
    });
  }

  /**
   * Enhance input area with ARIA attributes
   */
  private enhanceInputArea(): void {
    const inputField = document.querySelector('.dm-input-field') as HTMLTextAreaElement;
    if (inputField) {
      inputField.setAttribute('aria-label', 'Type a message');
      inputField.setAttribute('aria-describedby', 'dm-input-help');

      // Add help text
      const helpText = document.createElement('div');
      helpText.id = 'dm-input-help';
      helpText.className = 'sr-only';
      helpText.textContent = 'Press Enter to send message, Shift+Enter for new line';
      inputField.parentNode?.insertBefore(helpText, inputField.nextSibling);
    }

    document.querySelectorAll('.dm-input-btn').forEach(btn => {
      const element = btn as HTMLElement;
      if (element.textContent?.includes('send')) {
        element.setAttribute('aria-label', 'Send message');
        element.setAttribute('title', 'Send message (Enter)');
      }
    });
  }

  /**
   * Enhance search area with ARIA attributes
   */
  private enhanceSearchArea(): void {
    const searchInput = document.querySelector('.dm-search-input') as HTMLInputElement;
    if (searchInput) {
      searchInput.setAttribute('aria-label', 'Search for users to start a conversation');
      searchInput.setAttribute('aria-autocomplete', 'list');
      searchInput.setAttribute('aria-expanded', 'false');
    }

    const searchResults = document.querySelector('.dm-search-results');
    if (searchResults) {
      searchResults.setAttribute('role', 'listbox');
      searchResults.setAttribute('aria-label', 'Search results');
    }

    document.querySelectorAll('.dm-search-result-item').forEach((item, index) => {
      const element = item as HTMLElement;
      element.setAttribute('role', 'option');
      element.setAttribute('aria-posinset', (index + 1).toString());
      element.setAttribute(
        'aria-setsize',
        document.querySelectorAll('.dm-search-result-item').length.toString()
      );
    });
  }

  /**
   * Setup focus management
   */
  private setupFocusManagement(): void {
    // Add focus indicators
    const style = document.createElement('style');
    style.textContent = `
      .dm-focus-indicator {
        position: absolute;
        top: -2px;
        left: -2px;
        right: -2px;
        bottom: -2px;
        border: 2px solid var(--accent-color);
        border-radius: 6px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
        z-index: 1000;
      }
      
      .dm-focus-indicator.visible {
        opacity: 1;
      }
      
      .dm-sidebar *:focus-visible,
      .dm-chat-container *:focus-visible {
        outline: none;
        position: relative;
      }
      
      .dm-sidebar *:focus-visible::before,
      .dm-chat-container *:focus-visible::before {
        content: '';
        position: absolute;
        top: -2px;
        left: -2px;
        right: -2px;
        bottom: -2px;
        border: 2px solid var(--accent-color);
        border-radius: 6px;
        pointer-events: none;
        z-index: 1000;
      }
    `;
    document.head.appendChild(style);

    // Track focus changes
    document.addEventListener('focusin', this.handleFocusIn.bind(this));
    document.addEventListener('focusout', this.handleFocusOut.bind(this));
  }

  /**
   * Handle focus in
   */
  private handleFocusIn(event: FocusEvent): void {
    const target = event.target as HTMLElement;
    if (this.isKeyboardNavigation) {
      this.announceElementFocus(target);
    }
  }

  /**
   * Handle focus out
   */
  private handleFocusOut(_event: FocusEvent): void {
    // Clean up any focus indicators
  }

  /**
   * Setup screen reader support
   */
  private setupScreenReaderSupport(): void {
    // Add skip links
    this.addSkipLinks();

    // Enhance status announcements
    this.enhanceStatusAnnouncements();
  }

  /**
   * Add skip links for keyboard navigation
   */
  private addSkipLinks(): void {
    const skipLinks = [
      { href: '#dm-conversation-list', text: 'Skip to conversation list' },
      { href: '#dm-messages', text: 'Skip to messages' },
      { href: '#dm-input', text: 'Skip to message input' },
    ];

    skipLinks.forEach(link => {
      const skipLink = document.createElement('a');
      skipLink.href = link.href;
      skipLink.textContent = link.text;
      skipLink.className = 'dm-skip-link';
      document.body.insertBefore(skipLink, document.body.firstChild);
    });
  }

  /**
   * Enhance status announcements
   */
  private enhanceStatusAnnouncements(): void {
    // Listen for message events and announce them
    this.observeMessageChanges();
    this.observeConversationChanges();
    this.observeTypingIndicators();
  }

  /**
   * Observe message changes
   */
  private observeMessageChanges(): void {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as HTMLElement;
              if (element.classList.contains('dm-message')) {
                this.announceNewMessage(element);
              }
            }
          });
        }
      });
    });

    const messagesContainer = document.querySelector('.dm-messages');
    if (messagesContainer) {
      observer.observe(messagesContainer, { childList: true });
    }
  }

  /**
   * Observe conversation changes
   */
  private observeConversationChanges(): void {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          this.announceConversationListChanged();
        }
      });
    });

    const conversationList = document.querySelector('.dm-conversation-list');
    if (conversationList) {
      observer.observe(conversationList, { childList: true });
    }
  }

  /**
   * Observe typing indicators
   */
  private observeTypingIndicators(): void {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          const typingIndicator = document.querySelector('.dm-typing-indicator');
          if (typingIndicator && typingIndicator.textContent) {
            this.announce(typingIndicator.textContent);
          }
        }
      });
    });

    const chatContainer = document.querySelector('.dm-chat-container');
    if (chatContainer) {
      observer.observe(chatContainer, { childList: true, subtree: true });
    }
  }

  /**
   * Focus element with proper accessibility
   */
  private focusElement(element: HTMLElement): void {
    element.focus();

    // Scroll into view if needed
    const rect = element.getBoundingClientRect();
    const isInViewport =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth;

    if (!isInViewport) {
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /**
   * Announce message to screen readers
   */
  private announce(message: string): void {
    if (this.liveRegion) {
      this.liveRegion.textContent = message;

      // Clear after announcement
      setTimeout(() => {
        if (this.liveRegion) {
          this.liveRegion.textContent = '';
        }
      }, 1000);
    }
  }

  /**
   * Make important announcement
   */
  private announceImportant(message: string): void {
    if (this.announcer) {
      this.announcer.textContent = message;

      // Clear after announcement
      setTimeout(() => {
        if (this.announcer) {
          this.announcer.textContent = '';
        }
      }, 1000);
    }
  }

  /**
   * Announce element focus
   */
  private announceElementFocus(element: HTMLElement): void {
    const label =
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.textContent ||
      'Element';

    this.announce(`Focused on ${label}`);
  }

  /**
   * Announce new message
   */
  private announceNewMessage(messageElement: HTMLElement): void {
    const isOwn = messageElement.classList.contains('own');
    const sender = messageElement.querySelector('.dm-message-name')?.textContent;
    const content = messageElement.querySelector('.dm-message-text')?.textContent;

    let announcement = 'New message';
    if (!isOwn && sender) {
      announcement += ` from ${sender}`;
    }
    if (content) {
      announcement += `: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`;
    }

    this.announceImportant(announcement);
  }

  /**
   * Announce conversation list changed
   */
  private announceConversationListChanged(): void {
    const count = document.querySelectorAll('.dm-conversation-item').length;
    this.announce(`${count} conversations in list`);
  }

  /**
   * Announce conversation change
   */
  private announceConversationChange(element: HTMLElement, index: number, total: number): void {
    const name = element.querySelector('.dm-conversation-name')?.textContent || 'Unknown';
    this.announce(`Conversation ${index} of ${total}: ${name}`);
  }

  /**
   * Announce message change
   */
  private announceMessageChange(element: HTMLElement, index: number, total: number): void {
    const sender = element.querySelector('.dm-message-name')?.textContent || 'Unknown';
    const isOwn = element.classList.contains('own');
    const prefix = isOwn ? 'Your' : `${sender}'s`;
    this.announce(`${prefix} message ${index} of ${total}`);
  }

  /**
   * Update ARIA attributes dynamically
   */
  public updateAriaAttributes(): void {
    this.enhanceConversationList();
    this.enhanceMessageList();
  }

  /**
   * Enable/disable accessibility features
   */
  public setEnabled(enabled: boolean): void {
    if (enabled) {
      this.initializeAccessibility();
    } else {
      // Clean up
      this.liveRegion?.remove();
      this.announcer?.remove();
      document.removeEventListener('keydown', this.handleKeyDown.bind(this));
      document.removeEventListener('mousedown', this.handleMouseDown.bind(this));
    }
  }
}

// Export for use in the DM manager
window.DMAccessibilityEnhancer = DMAccessibilityEnhancer;
