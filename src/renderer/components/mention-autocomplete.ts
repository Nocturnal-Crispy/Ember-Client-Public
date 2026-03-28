/**
 * Mention Autocomplete Component
 * Shows a filterable popup of users and roles when the user types `@` in the message input.
 * Follows WAI-ARIA combobox + listbox pattern for accessibility.
 */
(function (): void {
  const log = window.emberLog.createLogger('MentionAutocomplete');
  const App = window.App;

  const MENTION_EVERYONE_PERM = 1n << 12n;
  const MAX_RESULTS = 20;
  const DEBOUNCE_MS = 100;

  let inputEl: HTMLTextAreaElement | null = null;
  let popupEl: HTMLDivElement | null = null;
  let liveRegion: HTMLDivElement | null = null;
  let isOpen = false;
  let activeIndex = -1;
  let items: MentionItem[] = [];
  let triggerStart = -1;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  interface MentionItem {
    kind: 'user' | 'role' | 'everyone';
    id: string;
    name: string;
    subtitle: string;
    avatar?: string;
    color?: string;
  }

  // ─── Scoring ──────────────────────────────────────────────────────────────

  function scoreMember(query: string, username: string, displayName?: string): number {
    const q = query.toLowerCase();
    const u = username.toLowerCase();
    const d = (displayName ?? username).toLowerCase();

    if (u === q || d === q) return 1000;
    if (u.startsWith(q)) return 800;
    if (d.startsWith(q)) return 790;

    // Word-boundary match on display name
    const words = d.split(/\s+/);
    if (words.some(w => w.startsWith(q))) return 600;

    if (u.includes(q)) return 400;
    if (d.includes(q)) return 390;

    // Simple fuzzy: characters appear in order
    let qi = 0;
    for (let i = 0; i < u.length && qi < q.length; i++) {
      if (u[i] === q[qi]) qi++;
    }
    if (qi === q.length) return 200;

    return -1;
  }

  // ─── Query ────────────────────────────────────────────────────────────────

  function buildItems(query: string): MentionItem[] {
    const results: (MentionItem & { score: number })[] = [];
    const members = App.currentMembers ?? [];
    const roles = App.currentRoles ?? [];
    const q = query.toLowerCase();

    // Members
    for (const m of members) {
      const s = scoreMember(q, m.username, m.username);
      if (s > 0) {
        results.push({
          kind: 'user',
          id: m.userId,
          name: m.username,
          subtitle: m.status ?? 'offline',
          avatar: m.avatar,
          score: s,
        });
      }
    }

    // Roles (skip @everyone, handled separately)
    // Show mentionable roles, plus all roles if user has ManageRoles or Administrator permission
    const MANAGE_ROLES = 1n << 8n;
    const ADMIN = 1n << 6n;
    const canMentionAll =
      (App.myPermissions & MANAGE_ROLES) !== 0n || (App.myPermissions & ADMIN) !== 0n;
    for (const r of roles) {
      if (r.isEveryone) continue;
      if (!r.mentionable && !canMentionAll) continue;
      const rName = r.name.toLowerCase();
      let s = -1;
      if (rName === q) s = 1000;
      else if (rName.startsWith(q)) s = 800;
      else if (rName.includes(q)) s = 400;
      if (s > 0) {
        results.push({
          kind: 'role',
          id: r.id,
          name: r.name,
          subtitle: 'Role',
          color: r.color || undefined,
          score: s,
        });
      }
    }

    // @everyone — only if user has MentionEveryone permission
    const hasEveryonePerm =
      (App.myPermissions & MENTION_EVERYONE_PERM) !== 0n ||
      // Administrator bypasses all
      (App.myPermissions & (1n << 6n)) !== 0n;

    if (hasEveryonePerm && 'everyone'.startsWith(q)) {
      const memberCount = members.length;
      results.push({
        kind: 'everyone',
        id: 'everyone',
        name: '@everyone',
        subtitle: `Notify all ${memberCount} members`,
        score: 500,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, MAX_RESULTS);
  }

  // ─── Popup DOM ────────────────────────────────────────────────────────────

  function createPopup(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'mention-autocomplete';
    el.id = 'mention-autocomplete-listbox';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', 'Mention suggestions');
    el.style.display = 'none';
    return el;
  }

  function createLiveRegion(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'mention-sr-live';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    return el;
  }

  function renderItems(): void {
    if (!popupEl) return;
    popupEl.innerHTML = '';

    let hasUsers = false;
    let hasRoles = false;
    let hasEveryone = false;

    for (const item of items) {
      if (item.kind === 'user' && !hasUsers) {
        hasUsers = true;
        const header = document.createElement('div');
        header.className = 'mention-section-header';
        header.setAttribute('role', 'presentation');
        header.setAttribute('aria-hidden', 'true');
        header.textContent = 'Members';
        popupEl.appendChild(header);
      }
      if (item.kind === 'role' && !hasRoles) {
        hasRoles = true;
        const header = document.createElement('div');
        header.className = 'mention-section-header';
        header.setAttribute('role', 'presentation');
        header.setAttribute('aria-hidden', 'true');
        header.textContent = 'Roles';
        popupEl.appendChild(header);
      }
      if (item.kind === 'everyone' && !hasEveryone) {
        hasEveryone = true;
        // No header for everyone, it's self-explanatory
      }

      const idx = items.indexOf(item);
      const div = document.createElement('div');
      div.className = `mention-item mention-item--${item.kind}`;
      div.id = `mention-item-${idx}`;
      div.setAttribute('role', 'option');
      div.setAttribute('aria-selected', idx === activeIndex ? 'true' : 'false');
      div.dataset['index'] = String(idx);

      // Avatar
      const avatarEl = document.createElement('div');
      avatarEl.className = 'mention-item-avatar';
      if (item.kind === 'user' && item.avatar) {
        const img = document.createElement('img');
        img.src = item.avatar;
        img.alt = '';
        avatarEl.appendChild(img);
      } else if (item.kind === 'role' && item.color) {
        avatarEl.style.background = item.color;
      } else if (item.kind === 'everyone') {
        avatarEl.textContent = '@';
      } else {
        avatarEl.textContent = item.name.charAt(0).toUpperCase();
      }
      div.appendChild(avatarEl);

      // Info
      const infoEl = document.createElement('div');
      infoEl.className = 'mention-item-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'mention-item-name';
      nameEl.textContent = item.kind === 'everyone' ? '@everyone' : `@${item.name}`;
      if (item.kind === 'role' && item.color) {
        nameEl.style.color = item.color;
      }
      infoEl.appendChild(nameEl);

      if (item.subtitle) {
        const subEl = document.createElement('div');
        subEl.className = 'mention-item-subtitle';
        subEl.textContent = item.subtitle;
        infoEl.appendChild(subEl);
      }
      div.appendChild(infoEl);

      // Click handler
      div.addEventListener('mousedown', e => {
        e.preventDefault(); // prevent textarea blur
        selectItem(idx);
      });

      div.addEventListener('mouseenter', () => {
        setActiveIndex(idx);
      });

      popupEl.appendChild(div);
    }

    // Scroll active into view
    if (activeIndex >= 0) {
      const activeEl = popupEl.querySelector(`#mention-item-${activeIndex}`);
      activeEl?.scrollIntoView({ block: 'nearest' });
    }

    // Announce to screen readers
    if (liveRegion) {
      liveRegion.textContent =
        items.length > 0
          ? `${items.length} mention suggestion${items.length !== 1 ? 's' : ''} available`
          : 'No mention suggestions';
    }
  }

  function setActiveIndex(idx: number): void {
    activeIndex = idx;
    if (!popupEl) return;

    const allItems = popupEl.querySelectorAll('[role="option"]');
    allItems.forEach((el, i) => {
      el.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      el.classList.toggle('mention-item--active', i === idx);
    });

    if (inputEl && idx >= 0) {
      inputEl.setAttribute('aria-activedescendant', `mention-item-${idx}`);
    } else if (inputEl) {
      inputEl.removeAttribute('aria-activedescendant');
    }
  }

  // ─── Open / Close ─────────────────────────────────────────────────────────

  function open(query: string): void {
    items = buildItems(query);
    if (items.length === 0) {
      close();
      return;
    }

    activeIndex = 0;
    isOpen = true;

    if (popupEl) {
      popupEl.style.display = '';
      renderItems();
      setActiveIndex(0);
    }

    if (inputEl) {
      inputEl.setAttribute('aria-expanded', 'true');
      inputEl.setAttribute('aria-controls', 'mention-autocomplete-listbox');
    }
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    activeIndex = -1;
    items = [];
    triggerStart = -1;

    if (popupEl) {
      popupEl.style.display = 'none';
      popupEl.innerHTML = '';
    }

    if (inputEl) {
      inputEl.setAttribute('aria-expanded', 'false');
      inputEl.removeAttribute('aria-activedescendant');
      inputEl.removeAttribute('aria-controls');
    }

    if (liveRegion) {
      liveRegion.textContent = '';
    }
  }

  // ─── Selection ────────────────────────────────────────────────────────────

  function selectItem(idx: number): void {
    const item = items[idx];
    if (!item || !inputEl) return;

    const before = inputEl.value.substring(0, triggerStart);
    const after = inputEl.value.substring(inputEl.selectionStart ?? inputEl.value.length);

    let insertText: string;
    if (item.kind === 'user') {
      insertText = `@${item.name} `;
    } else if (item.kind === 'role') {
      insertText = `@${item.name} `;
    } else {
      insertText = '@everyone ';
    }

    inputEl.value = before + insertText + after;
    const newPos = before.length + insertText.length;
    inputEl.setSelectionRange(newPos, newPos);
    inputEl.focus();

    // Trigger input event for auto-resize
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));

    log.debug('Mention selected', { kind: item.kind, name: item.name });
    close();
  }

  // ─── Trigger Detection ────────────────────────────────────────────────────

  function isInsideCodeBlock(text: string, pos: number): boolean {
    // Check for backtick code context
    const before = text.substring(0, pos);
    // Count backticks — odd means we're inside inline code
    const singleTicks = (before.match(/`/g) ?? []).length;
    if (singleTicks % 2 !== 0) return true;
    // Check triple backtick blocks
    const tripleOpens = (before.match(/```/g) ?? []).length;
    return tripleOpens % 2 !== 0;
  }

  function detectTrigger(): { start: number; query: string } | null {
    if (!inputEl) return null;
    const pos = inputEl.selectionStart ?? 0;
    const text = inputEl.value.substring(0, pos);

    // Match @ at word boundary
    const match = text.match(/(^|[\s(])@(\w{0,20})$/);
    if (!match) return null;

    const atPos = text.length - match[2].length - 1; // position of @
    if (isInsideCodeBlock(text, atPos)) return null;

    return { start: atPos, query: match[2] };
  }

  // ─── Input Handler ────────────────────────────────────────────────────────

  function onInput(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const trigger = detectTrigger();
      if (trigger) {
        triggerStart = trigger.start;
        open(trigger.query);
      } else {
        close();
      }
    }, DEBOUNCE_MS);
  }

  // ─── Keyboard Handler ────────────────────────────────────────────────────

  function onKeydown(e: KeyboardEvent): void {
    if (!isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = activeIndex + 1 >= items.length ? 0 : activeIndex + 1;
      setActiveIndex(next);
      const el = popupEl?.querySelector(`#mention-item-${next}`);
      el?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = activeIndex - 1 < 0 ? items.length - 1 : activeIndex - 1;
      setActiveIndex(prev);
      const el = popupEl?.querySelector(`#mention-item-${prev}`);
      el?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (activeIndex >= 0 && items.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        selectItem(activeIndex);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  // ─── Click Outside ────────────────────────────────────────────────────────

  function onDocumentClick(e: MouseEvent): void {
    if (!isOpen) return;
    const target = e.target as HTMLElement;
    if (popupEl?.contains(target)) return;
    if (inputEl === target) return;
    close();
  }

  // ─── Init / Destroy ───────────────────────────────────────────────────────

  function initMentionAutocomplete(input: HTMLTextAreaElement): void {
    inputEl = input;

    // Create popup and append next to the input's parent
    popupEl = createPopup();
    liveRegion = createLiveRegion();

    const inputWrapper = input.closest('.message-input-wrapper') ?? input.parentElement;
    if (inputWrapper) {
      const container = inputWrapper as HTMLElement;
      container.style.position = 'relative';
      container.appendChild(popupEl);
      container.appendChild(liveRegion);
    }

    // ARIA setup
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-autocomplete', 'list');

    // Event listeners
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeydown, true); // capture phase to intercept before renderer
    document.addEventListener('click', onDocumentClick);

    log.info('Mention autocomplete initialized');
  }

  function destroyMentionAutocomplete(): void {
    if (inputEl) {
      inputEl.removeEventListener('input', onInput);
      inputEl.removeEventListener('keydown', onKeydown, true);
      inputEl.removeAttribute('role');
      inputEl.removeAttribute('aria-expanded');
      inputEl.removeAttribute('aria-haspopup');
      inputEl.removeAttribute('aria-autocomplete');
      inputEl.removeAttribute('aria-controls');
      inputEl.removeAttribute('aria-activedescendant');
    }
    document.removeEventListener('click', onDocumentClick);
    popupEl?.remove();
    liveRegion?.remove();
    popupEl = null;
    liveRegion = null;
    inputEl = null;
    isOpen = false;
    log.info('Mention autocomplete destroyed');
  }

  function isMentionAutocompleteOpen(): boolean {
    return isOpen;
  }

  // ─── Expose globals ───────────────────────────────────────────────────────

  window.initMentionAutocomplete = initMentionAutocomplete;
  window.destroyMentionAutocomplete = destroyMentionAutocomplete;
  window.isMentionAutocompleteOpen = isMentionAutocompleteOpen;
})();
