/**
 * ReactionService — handles message reaction lifecycle.
 * Encrypt/decrypt reaction payloads, API calls, caching,
 * DOM rendering, and real-time WebSocket updates.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger('ReactionService');

  // ── Types ────────────────────────────────────────────────────────────────

  interface ReactionSummary {
    readonly emoji: string;
    count: number;
    reacted: boolean;
    readonly users: string[];
  }

  interface AuthData {
    token: string;
    userId: string;
    deviceId: string;
    hostname: string;
    username: string;
  }

  interface MessageEventPayload {
    id: string;
    targetMessageId: string;
    channelId: string;
    eventType: string;
    senderUserId: string;
    senderDeviceId: string;
    epoch: number;
    ciphertext: string;
    nonce: string;
    createdAt: string | number;
  }

  interface DecryptedReaction {
    emoji: string;
    action: 'add' | 'remove';
  }

  // ── State ─────────────────────────────────────────────────────────────────

  let currentUserId = '';

  // Resolve the current user ID from auth once
  ipcRenderer.invoke('get-auth').then((auth: unknown) => {
    const a = auth as { userId?: string } | null;
    if (a?.userId) currentUserId = a.userId;
  });

  // ── Cache ────────────────────────────────────────────────────────────────

  const reactionCache = new Map<string, ReactionSummary[]>();
  const pendingFetches = new Set<string>();

  const QUICK_REACTIONS = [
    '\u{1F44D}',
    '\u{2764}\u{FE0F}',
    '\u{1F602}',
    '\u{1F62E}',
    '\u{1F622}',
    '\u{1F525}',
  ];

  // ── Encryption helpers ───────────────────────────────────────────────────

  function getHistoryCrypto(): {
    encrypt(
      emberId: string,
      text: string
    ): Promise<{ ciphertext: string; nonce: string; epoch: number } | null>;
    decrypt(emberId: string, ct: string, nonce: string, epoch: number): Promise<string | null>;
  } | null {
    return (window as any).historyCryptoService ?? null;
  }

  async function encryptReaction(
    emberId: string,
    emoji: string,
    action: 'add' | 'remove'
  ): Promise<{ ciphertext: string; nonce: string; epoch: number } | null> {
    const crypto = getHistoryCrypto();
    if (!crypto) {
      log.warn('History crypto not available for reaction encryption');
      return null;
    }
    const payload = JSON.stringify({ emoji, action });
    return crypto.encrypt(emberId, payload);
  }

  async function decryptReaction(
    emberId: string,
    ciphertext: string,
    nonce: string,
    epoch: number
  ): Promise<DecryptedReaction | null> {
    const crypto = getHistoryCrypto();
    if (!crypto) return null;
    try {
      const plaintext = await crypto.decrypt(emberId, ciphertext, nonce, epoch);
      if (!plaintext) return null;
      return JSON.parse(plaintext) as DecryptedReaction;
    } catch {
      log.warn('Failed to decrypt reaction');
      return null;
    }
  }

  // ── API calls ────────────────────────────────────────────────────────────

  async function getAuth(): Promise<AuthData | null> {
    const auth = (await ipcRenderer.invoke('get-auth')) as AuthData | null;
    if (!auth || !auth.token || !auth.hostname) return null;
    return auth;
  }

  async function postReactionEvent(
    messageId: string,
    eventType: 'reaction' | 'reaction_remove',
    encrypted: { ciphertext: string; nonce: string; epoch: number }
  ): Promise<boolean> {
    const auth = await getAuth();
    if (!auth) return false;
    try {
      const response = await fetch(`${auth.hostname}/api/v1/messages/${messageId}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          eventType,
          epoch: encrypted.epoch,
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
        }),
      });
      return response.ok;
    } catch (err) {
      log.error('Failed to post reaction event', { error: (err as Error).message });
      return false;
    }
  }

  async function fetchBatchEvents(
    messageIds: string[]
  ): Promise<Record<string, MessageEventPayload[]>> {
    const auth = await getAuth();
    if (!auth) return {};
    try {
      const response = await fetch(`${auth.hostname}/api/v1/messages/events/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ messageIds }),
      });
      if (!response.ok) return {};
      const data = (await response.json()) as { events: Record<string, MessageEventPayload[]> };
      return data.events ?? {};
    } catch (err) {
      log.error('Failed to batch fetch events', { error: (err as Error).message });
      return {};
    }
  }

  // ── Aggregation ──────────────────────────────────────────────────────────

  function aggregateReactions(
    events: Array<{ emoji: string; action: 'add' | 'remove'; senderUserId: string }>,
    currentUserId: string
  ): ReactionSummary[] {
    // Track per-user, per-emoji state
    const userReactions = new Map<string, Set<string>>();

    for (const ev of events) {
      const key = ev.emoji;
      if (ev.action === 'add') {
        if (!userReactions.has(key)) userReactions.set(key, new Set());
        userReactions.get(key)!.add(ev.senderUserId);
      } else if (ev.action === 'remove') {
        userReactions.get(key)?.delete(ev.senderUserId);
      }
    }

    const summaries: ReactionSummary[] = [];
    for (const [emoji, users] of userReactions) {
      if (users.size > 0) {
        summaries.push({
          emoji,
          count: users.size,
          reacted: users.has(currentUserId),
          users: Array.from(users),
        });
      }
    }

    return summaries;
  }

  // ── DOM rendering ────────────────────────────────────────────────────────

  function renderReactions(messageEl: HTMLElement, reactions: ReactionSummary[]): void {
    let container = messageEl.querySelector('.message-reactions') as HTMLElement | null;

    if (reactions.length === 0) {
      if (container) container.replaceChildren();
      return;
    }

    if (!container) {
      container = document.createElement('div');
      container.className = 'message-reactions';
      const actionBar = messageEl.querySelector('.message-action-bar');
      if (actionBar) {
        messageEl.insertBefore(container, actionBar);
      } else {
        messageEl.appendChild(container);
      }
    }

    const messageId = messageEl.dataset['messageId'] ?? '';

    const pills = reactions.map(r => {
      const btn = document.createElement('button');
      btn.className = `reaction-pill${r.reacted ? ' reacted' : ''}`;
      btn.dataset['emoji'] = r.emoji;
      btn.dataset['count'] = String(r.count);
      btn.setAttribute(
        'aria-label',
        `${r.emoji}, ${r.count} reaction${r.count !== 1 ? 's' : ''}${r.reacted ? ', you reacted' : ''}`
      );

      const emojiSpan = document.createElement('span');
      emojiSpan.className = 'reaction-emoji';
      emojiSpan.textContent = r.emoji;

      const countSpan = document.createElement('span');
      countSpan.className = 'reaction-count';
      countSpan.textContent = String(r.count);

      btn.appendChild(emojiSpan);
      btn.appendChild(countSpan);

      btn.addEventListener('click', () => {
        toggleReaction(messageId, r.emoji);
      });

      // Tooltip with usernames on hover
      btn.addEventListener('mouseenter', () => {
        showReactionTooltip(btn, r);
      });
      btn.addEventListener('mouseleave', () => {
        hideReactionTooltip();
      });

      return btn;
    });

    // "+" button to add a new reaction
    const addBtn = document.createElement('button');
    addBtn.className = 'reaction-add-btn';
    addBtn.setAttribute('aria-label', 'Add reaction');
    addBtn.textContent = '+';
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      openQuickReactionTray(addBtn, messageId);
    });

    container.replaceChildren(...pills, addBtn);
  }

  // ── Quick reaction tray ──────────────────────────────────────────────────

  let activeTray: HTMLElement | null = null;

  function closeQuickReactionTray(): void {
    if (activeTray) {
      activeTray.remove();
      activeTray = null;
    }
  }

  function openQuickReactionTray(trigger: HTMLElement, messageId: string): void {
    closeQuickReactionTray();

    const tray = document.createElement('div');
    tray.className = 'quick-reaction-tray';
    tray.setAttribute('role', 'toolbar');
    tray.setAttribute('aria-label', 'Quick reactions');

    for (const emoji of QUICK_REACTIONS) {
      const btn = document.createElement('button');
      btn.className = 'quick-reaction-btn';
      btn.textContent = emoji;
      btn.setAttribute('aria-label', `React with ${emoji}`);
      btn.addEventListener('click', e => {
        e.stopPropagation();
        closeQuickReactionTray();
        toggleReaction(messageId, emoji);
      });
      tray.appendChild(btn);
    }

    // "..." button for full emoji picker
    const moreBtn = document.createElement('button');
    moreBtn.className = 'quick-reaction-btn quick-reaction-more';
    moreBtn.textContent = '\u{2026}';
    moreBtn.setAttribute('aria-label', 'More reactions');
    moreBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeQuickReactionTray();
      const openPickerWithCallback = (window as any).openEmojiPickerWithCallback as
        | ((trigger: HTMLElement, callback: (emoji: string) => void) => void)
        | undefined;
      if (openPickerWithCallback) {
        openPickerWithCallback(trigger, (emoji: string) => {
          toggleReaction(messageId, emoji);
        });
      }
    });
    tray.appendChild(moreBtn);

    // Position near trigger
    const rect = trigger.getBoundingClientRect();
    tray.style.position = 'fixed';
    tray.style.zIndex = '10002';

    let left = rect.left;
    const trayWidth = 280;
    if (left + trayWidth > window.innerWidth - 8) {
      left = window.innerWidth - trayWidth - 8;
    }
    if (left < 8) left = 8;

    let top = rect.top - 40;
    if (top < 8) top = rect.bottom + 4;

    tray.style.left = `${left}px`;
    tray.style.top = `${top}px`;

    document.body.appendChild(tray);
    activeTray = tray;

    // Close on outside click
    const closeHandler = (e: MouseEvent) => {
      if (!tray.contains(e.target as Node)) {
        closeQuickReactionTray();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);

    // Close on ESC
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeQuickReactionTray();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  // ── Reaction tooltip ─────────────────────────────────────────────────────

  let tooltipEl: HTMLElement | null = null;

  function showReactionTooltip(target: HTMLElement, reaction: ReactionSummary): void {
    hideReactionTooltip();

    tooltipEl = document.createElement('div');
    tooltipEl.className = 'reaction-tooltip';

    const usernames = reaction.users
      .map(uid => {
        const member = App.currentMembers?.find((m: { userId: string }) => m.userId === uid);
        return member ? (member as { username: string }).username : 'Unknown';
      })
      .join(', ');

    tooltipEl.textContent = `${reaction.emoji} ${usernames}`;

    const rect = target.getBoundingClientRect();
    tooltipEl.style.position = 'fixed';
    tooltipEl.style.left = `${rect.left}px`;
    tooltipEl.style.top = `${rect.top - 28}px`;
    tooltipEl.style.zIndex = '10003';

    document.body.appendChild(tooltipEl);
  }

  function hideReactionTooltip(): void {
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  }

  // ── Core actions ─────────────────────────────────────────────────────────

  async function addReaction(messageId: string, emoji: string): Promise<void> {
    const emberId = App.activeEmberId;
    if (!emberId) return;

    const encrypted = await encryptReaction(emberId, emoji, 'add');
    if (!encrypted) {
      log.warn('Failed to encrypt reaction');
      return;
    }

    // Optimistic UI update
    applyOptimisticReaction(messageId, emoji, 'add');

    const ok = await postReactionEvent(messageId, 'reaction', encrypted);
    if (!ok) {
      applyOptimisticReaction(messageId, emoji, 'remove');
      log.warn('Failed to post reaction, rolled back');
    }
  }

  async function removeReaction(messageId: string, emoji: string): Promise<void> {
    const emberId = App.activeEmberId;
    if (!emberId) return;

    const encrypted = await encryptReaction(emberId, emoji, 'remove');
    if (!encrypted) return;

    applyOptimisticReaction(messageId, emoji, 'remove');

    const ok = await postReactionEvent(messageId, 'reaction_remove', encrypted);
    if (!ok) {
      applyOptimisticReaction(messageId, emoji, 'add');
      log.warn('Failed to post reaction_remove, rolled back');
    }
  }

  async function toggleReaction(messageId: string, emoji: string): Promise<void> {
    const cached = reactionCache.get(messageId) ?? [];
    const existing = cached.find(r => r.emoji === emoji);
    if (existing?.reacted) {
      await removeReaction(messageId, emoji);
    } else {
      await addReaction(messageId, emoji);
    }
  }

  function applyOptimisticReaction(
    messageId: string,
    emoji: string,
    action: 'add' | 'remove'
  ): void {
    const auth = currentUserId;
    const cached = reactionCache.get(messageId) ?? [];

    const updated = [...cached];
    const idx = updated.findIndex(r => r.emoji === emoji);

    if (action === 'add') {
      if (idx >= 0) {
        if (!updated[idx].reacted) {
          updated[idx] = {
            ...updated[idx],
            count: updated[idx].count + 1,
            reacted: true,
            users: [...updated[idx].users, auth],
          };
        }
      } else {
        updated.push({ emoji, count: 1, reacted: true, users: [auth] });
      }
    } else {
      if (idx >= 0 && updated[idx].reacted) {
        const newCount = updated[idx].count - 1;
        if (newCount <= 0) {
          updated.splice(idx, 1);
        } else {
          updated[idx] = {
            ...updated[idx],
            count: newCount,
            reacted: false,
            users: updated[idx].users.filter(u => u !== auth),
          };
        }
      }
    }

    reactionCache.set(messageId, updated);
    renderReactionsForMessage(messageId, updated);
  }

  function renderReactionsForMessage(messageId: string, reactions: ReactionSummary[]): void {
    const el = document.querySelector(
      `[data-message-id="${CSS.escape(messageId)}"]`
    ) as HTMLElement | null;
    if (el) renderReactions(el, reactions);
  }

  // ── WebSocket handler ────────────────────────────────────────────────────

  async function handleMessageEvent(payload: MessageEventPayload): Promise<void> {
    if (payload.eventType !== 'reaction' && payload.eventType !== 'reaction_remove') return;

    const emberId = App.activeEmberId;
    if (!emberId) return;

    const auth = currentUserId;

    // Skip if this is our own reaction (already handled optimistically)
    if (payload.senderUserId === auth) return;

    const decrypted = await decryptReaction(
      emberId,
      payload.ciphertext,
      payload.nonce,
      payload.epoch
    );
    if (!decrypted) return;

    const messageId = payload.targetMessageId;
    const cached = reactionCache.get(messageId) ?? [];
    const updated = [...cached];
    const idx = updated.findIndex(r => r.emoji === decrypted.emoji);

    if (decrypted.action === 'add') {
      if (idx >= 0) {
        if (!updated[idx].users.includes(payload.senderUserId)) {
          updated[idx] = {
            ...updated[idx],
            count: updated[idx].count + 1,
            users: [...updated[idx].users, payload.senderUserId],
          };
        }
      } else {
        updated.push({
          emoji: decrypted.emoji,
          count: 1,
          reacted: false,
          users: [payload.senderUserId],
        });
      }
    } else {
      if (idx >= 0) {
        const newUsers = updated[idx].users.filter(u => u !== payload.senderUserId);
        if (newUsers.length === 0) {
          updated.splice(idx, 1);
        } else {
          updated[idx] = { ...updated[idx], count: newUsers.length, users: newUsers };
        }
      }
    }

    reactionCache.set(messageId, updated);
    renderReactionsForMessage(messageId, updated);
  }

  // ── Lazy loading via IntersectionObserver ─────────────────────────────────

  const observer = new IntersectionObserver(
    entries => {
      const visibleIds: string[] = [];
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement;
          const msgId = el.dataset['messageId'];
          if (!msgId) continue;

          // If already cached, re-render onto the (possibly fresh) DOM element
          const cached = reactionCache.get(msgId);
          if (cached) {
            renderReactions(el, cached);
            continue;
          }

          if (!pendingFetches.has(msgId)) {
            visibleIds.push(msgId);
            pendingFetches.add(msgId);
          }
        }
      }
      if (visibleIds.length > 0) {
        loadReactionsForMessages(visibleIds);
      }
    },
    { rootMargin: '200px' }
  );

  function observeMessage(el: HTMLElement): void {
    observer.observe(el);
  }

  async function loadReactionsForMessages(messageIds: string[]): Promise<void> {
    const emberId = App.activeEmberId;
    if (!emberId) return;

    const auth = currentUserId;
    const batchEvents = await fetchBatchEvents(messageIds);

    for (const msgId of messageIds) {
      const events = batchEvents[msgId] ?? [];
      const reactionEvents = events.filter(
        e => e.eventType === 'reaction' || e.eventType === 'reaction_remove'
      );

      const decryptedEvents: Array<{
        emoji: string;
        action: 'add' | 'remove';
        senderUserId: string;
      }> = [];

      for (const ev of reactionEvents) {
        const decrypted = await decryptReaction(emberId, ev.ciphertext, ev.nonce, ev.epoch);
        if (decrypted) {
          decryptedEvents.push({
            emoji: decrypted.emoji,
            action: ev.eventType === 'reaction' ? 'add' : 'remove',
            senderUserId: ev.senderUserId,
          });
        }
      }

      const summaries = aggregateReactions(decryptedEvents, auth);
      reactionCache.set(msgId, summaries);
      pendingFetches.delete(msgId);
      renderReactionsForMessage(msgId, summaries);
    }
  }

  function clearCache(): void {
    reactionCache.clear();
    pendingFetches.clear();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  (window as any).reactionService = {
    addReaction,
    removeReaction,
    toggleReaction,
    handleMessageEvent,
    loadReactionsForMessages,
    observeMessage,
    renderReactions,
    clearCache,
    openQuickReactionTray,
    closeQuickReactionTray,
    QUICK_REACTIONS,
  };
})();
