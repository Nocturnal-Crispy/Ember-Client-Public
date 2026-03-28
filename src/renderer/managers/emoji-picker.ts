/**
 * Emoji Picker — floating emoji selector panel.
 * Exposes window.openEmojiPicker(triggerEl, inputEl) to open the picker
 * anchored near triggerEl and insert the chosen emoji into inputEl.
 */
(function (): void {
  const log = window.emberLog.createLogger('EmojiPicker');

  // ── Emoji data ────────────────────────────────────────────────────────────

  interface EmojiCategory {
    label: string;
    icon: string;
    emojis: string[];
  }

  const CATEGORIES: EmojiCategory[] = [
    {
      label: 'Smileys',
      icon: '😊',
      emojis: [
        '😀',
        '😃',
        '😄',
        '😁',
        '😆',
        '😅',
        '🤣',
        '😂',
        '🙂',
        '🙃',
        '😉',
        '😊',
        '😇',
        '🥰',
        '😍',
        '🤩',
        '😘',
        '😗',
        '😚',
        '😙',
        '🥲',
        '😋',
        '😛',
        '😜',
        '🤪',
        '😝',
        '🤑',
        '🤗',
        '🤭',
        '🤫',
        '🤔',
        '🤐',
        '🤨',
        '😐',
        '😑',
        '😶',
        '😏',
        '😒',
        '🙄',
        '😬',
        '🤥',
        '😌',
        '😔',
        '😪',
        '🤤',
        '😴',
        '😷',
        '🤒',
      ],
    },
    {
      label: 'People',
      icon: '👍',
      emojis: [
        '👋',
        '🤚',
        '🖐️',
        '✋',
        '🖖',
        '👌',
        '🤌',
        '🤏',
        '✌️',
        '🤞',
        '🤟',
        '🤘',
        '🤙',
        '👈',
        '👉',
        '👆',
        '🖕',
        '👇',
        '☝️',
        '👍',
        '👎',
        '✊',
        '👊',
        '🤛',
        '🤜',
        '👏',
        '🙌',
        '👐',
        '🤲',
        '🙏',
        '✍️',
        '💅',
        '🤳',
        '💪',
        '🦵',
        '🦶',
        '👂',
        '🦻',
        '👃',
        '🫀',
        '🫁',
        '🧠',
        '🦷',
        '🦴',
        '👀',
        '👁️',
        '👅',
        '👄',
      ],
    },
    {
      label: 'Animals',
      icon: '🐶',
      emojis: [
        '🐶',
        '🐱',
        '🐭',
        '🐹',
        '🐰',
        '🦊',
        '🐻',
        '🐼',
        '🐻‍❄️',
        '🐨',
        '🐯',
        '🦁',
        '🐮',
        '🐷',
        '🐸',
        '🐵',
        '🙈',
        '🙉',
        '🙊',
        '🐔',
        '🐧',
        '🐦',
        '🐤',
        '🦆',
        '🦅',
        '🦉',
        '🦇',
        '🐺',
        '🐗',
        '🐴',
        '🦄',
        '🐝',
        '🐛',
        '🦋',
        '🐌',
        '🐞',
        '🐜',
        '🦟',
        '🦗',
        '🦂',
        '🐢',
        '🐍',
        '🦎',
        '🐊',
        '🐸',
        '🦑',
        '🐙',
        '🦈',
      ],
    },
    {
      label: 'Food',
      icon: '🍕',
      emojis: [
        '🍎',
        '🍊',
        '🍋',
        '🍇',
        '🍓',
        '🫐',
        '🍈',
        '🍒',
        '🍑',
        '🥭',
        '🍍',
        '🥥',
        '🥝',
        '🍅',
        '🥑',
        '🍆',
        '🥦',
        '🥬',
        '🥒',
        '🌶️',
        '🫑',
        '🧄',
        '🧅',
        '🥕',
        '🌽',
        '🍔',
        '🍟',
        '🍕',
        '🌭',
        '🥪',
        '🌮',
        '🌯',
        '🥙',
        '🧆',
        '🥚',
        '🍳',
        '🥞',
        '🧇',
        '🧈',
        '🍰',
        '🎂',
        '🧁',
        '🍩',
        '🍪',
        '🍫',
        '☕',
        '🧋',
        '🍺',
      ],
    },
    {
      label: 'Activities',
      icon: '⚽',
      emojis: [
        '⚽',
        '🏀',
        '🏈',
        '⚾',
        '🥎',
        '🎾',
        '🏐',
        '🏉',
        '🥏',
        '🎱',
        '🪀',
        '🏓',
        '🏸',
        '🏒',
        '🥊',
        '🎯',
        '🪃',
        '🥅',
        '⛳',
        '🎣',
        '🤿',
        '🎽',
        '🎿',
        '🛷',
        '🥌',
        '🎮',
        '🕹️',
        '🎲',
        '🧩',
        '♟️',
        '🎭',
        '🎨',
        '🖼️',
        '🎬',
        '🎤',
        '🎧',
        '🎸',
        '🎹',
        '🥁',
        '🎷',
        '🎺',
        '🎻',
        '🪕',
        '🎙️',
        '🎚️',
        '🎛️',
        '📻',
        '🎵',
      ],
    },
    {
      label: 'Travel',
      icon: '✈️',
      emojis: [
        '🚗',
        '🚕',
        '🚙',
        '🚌',
        '🚎',
        '🏎️',
        '🚓',
        '🚑',
        '🚒',
        '🚐',
        '🛻',
        '🚚',
        '🚛',
        '🚜',
        '🛵',
        '🏍️',
        '🚲',
        '🛴',
        '🚨',
        '🚍',
        '🚘',
        '✈️',
        '🚀',
        '🛸',
        '🚁',
        '⛵',
        '🚢',
        '🛳️',
        '🏖️',
        '🏝️',
        '🏔️',
        '🗻',
        '🏕️',
        '🌋',
        '🏜️',
        '🏠',
        '🏙️',
        '🌃',
        '🌆',
        '🌇',
        '🌉',
        '🎆',
        '🎇',
        '🗼',
        '🗽',
        '🗿',
        '⛩️',
        '🌐',
      ],
    },
    {
      label: 'Objects',
      icon: '💡',
      emojis: [
        '⌚',
        '📱',
        '💻',
        '⌨️',
        '🖥️',
        '🖨️',
        '🖱️',
        '💾',
        '💿',
        '📷',
        '📸',
        '📹',
        '📺',
        '📻',
        '🎙️',
        '📞',
        '☎️',
        '📟',
        '📠',
        '🔋',
        '🔌',
        '💡',
        '🔦',
        '🕯️',
        '🪔',
        '🧲',
        '💰',
        '💳',
        '💎',
        '⚙️',
        '🔧',
        '🔩',
        '🪛',
        '🔨',
        '⛏️',
        '🛠️',
        '🧰',
        '🔑',
        '🗝️',
        '🔐',
        '🔒',
        '🔓',
        '📦',
        '📫',
        '📮',
        '🗑️',
        '📚',
        '📖',
      ],
    },
    {
      label: 'Symbols',
      icon: '❤️',
      emojis: [
        '❤️',
        '🧡',
        '💛',
        '💚',
        '💙',
        '💜',
        '🖤',
        '🤍',
        '🤎',
        '❤️‍🔥',
        '❤️‍🩹',
        '💔',
        '💕',
        '💞',
        '💓',
        '💗',
        '💖',
        '💘',
        '💝',
        '💟',
        '☮️',
        '✝️',
        '☪️',
        '🕉️',
        '✨',
        '⭐',
        '🌟',
        '💫',
        '⚡',
        '🔥',
        '💥',
        '❄️',
        '🌈',
        '☀️',
        '🌤️',
        '⛅',
        '🌦️',
        '🌧️',
        '⛈️',
        '🌩️',
        '🌪️',
        '🌫️',
        '🌊',
        '💧',
        '💦',
        '☂️',
        '☁️',
        '🌙',
      ],
    },
  ];

  // ── State ─────────────────────────────────────────────────────────────────

  let panel: HTMLElement | null = null;
  let categoriesEl: HTMLElement | null = null;
  let gridEl: HTMLElement | null = null;
  let activeInput: HTMLTextAreaElement | HTMLInputElement | null = null;
  let outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  let escKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  // ── Initialise DOM references ─────────────────────────────────────────────

  function init(): void {
    panel = document.getElementById('emoji-picker-panel');
    categoriesEl = document.getElementById('emoji-picker-categories');
    gridEl = document.getElementById('emoji-picker-grid');

    if (!panel || !categoriesEl || !gridEl) {
      log.error('Emoji picker elements not found in DOM');
      return;
    }

    buildCategoryTabs();
    renderGrid(0);
    log.debug('Emoji picker initialised');
  }

  // ── Build category tabs ───────────────────────────────────────────────────

  function buildCategoryTabs(): void {
    if (!categoriesEl) return;
    categoriesEl.replaceChildren();

    CATEGORIES.forEach((cat, idx) => {
      const btn = document.createElement('button');
      btn.className = `emoji-picker-category-btn${idx === 0 ? ' active' : ''}`;
      btn.textContent = cat.icon;
      btn.title = cat.label;
      btn.setAttribute('aria-label', cat.label);
      btn.addEventListener('click', e => {
        e.stopPropagation();
        selectCategory(idx);
      });
      categoriesEl!.appendChild(btn);
    });
  }

  // ── Render emoji grid for a category ─────────────────────────────────────

  function renderGrid(categoryIndex: number): void {
    if (!gridEl) return;
    gridEl.replaceChildren();

    const emojis = CATEGORIES[categoryIndex].emojis;
    emojis.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'emoji-btn';
      btn.textContent = emoji;
      btn.title = emoji;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        insertEmoji(emoji);
      });
      gridEl!.appendChild(btn);
    });
  }

  // ── Select a category tab ─────────────────────────────────────────────────

  function selectCategory(idx: number): void {
    categoriesEl?.querySelectorAll('.emoji-picker-category-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === idx);
    });
    renderGrid(idx);
  }

  // ── Insert emoji into the target input at cursor ──────────────────────────

  let activeCallback: ((emoji: string) => void) | null = null;

  function insertEmoji(emoji: string): void {
    if (activeCallback) {
      activeCallback(emoji);
      closePanel();
      return;
    }
    if (!activeInput) return;

    const start = activeInput.selectionStart ?? activeInput.value.length;
    const end = activeInput.selectionEnd ?? activeInput.value.length;
    const before = activeInput.value.slice(0, start);
    const after = activeInput.value.slice(end);

    activeInput.value = before + emoji + after;

    // Move cursor after inserted emoji
    const newPos = start + emoji.length;
    activeInput.setSelectionRange(newPos, newPos);

    // Trigger input event so auto-resize and character counters update
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
    activeInput.focus();
  }

  // ── Position panel near trigger ───────────────────────────────────────────

  function positionPanel(trigger: HTMLElement): void {
    if (!panel) return;

    const rect = trigger.getBoundingClientRect();
    const panelWidth = 320;
    const panelHeight = 300; // approximate

    let left = rect.left;
    let top = rect.top - panelHeight - 8;

    // Clamp horizontally
    if (left + panelWidth > window.innerWidth - 8) {
      left = window.innerWidth - panelWidth - 8;
    }
    if (left < 8) left = 8;

    // If no room above, show below the trigger
    if (top < 8) {
      top = rect.bottom + 8;
    }

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  // ── Open / close ──────────────────────────────────────────────────────────

  function openPanel(trigger: HTMLElement, input: HTMLTextAreaElement | HTMLInputElement): void {
    if (!panel) {
      init();
    }
    if (!panel) return;

    // Toggle: close if already open for same trigger
    if (!panel.classList.contains('hidden') && activeInput === input) {
      closePanel();
      return;
    }

    activeInput = input;
    positionPanel(trigger);
    panel.classList.remove('hidden');

    // Reset to first category each open
    selectCategory(0);

    // Close on outside click
    outsideClickHandler = (e: MouseEvent) => {
      if (!panel!.contains(e.target as Node) && e.target !== trigger) {
        closePanel();
      }
    };
    setTimeout(() => document.addEventListener('click', outsideClickHandler!), 0);

    // Close on ESC
    escKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    document.addEventListener('keydown', escKeyHandler);
  }

  function closePanel(): void {
    if (!panel) return;
    panel.classList.add('hidden');
    activeInput = null;
    activeCallback = null;

    if (outsideClickHandler) {
      document.removeEventListener('click', outsideClickHandler);
      outsideClickHandler = null;
    }
    if (escKeyHandler) {
      document.removeEventListener('keydown', escKeyHandler);
      escKeyHandler = null;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  (window as any).openEmojiPicker = function (
    trigger: HTMLElement,
    input: HTMLTextAreaElement | HTMLInputElement
  ): void {
    if (!panel) init();
    openPanel(trigger, input);
  };

  (window as any).openEmojiPickerWithCallback = function (
    trigger: HTMLElement,
    callback: (emoji: string) => void
  ): void {
    if (!panel) init();
    if (!panel) return;

    activeCallback = callback;
    activeInput = null;
    positionPanel(trigger);
    panel.classList.remove('hidden');
    selectCategory(0);

    outsideClickHandler = (e: MouseEvent) => {
      if (!panel!.contains(e.target as Node) && e.target !== trigger) {
        closePanel();
      }
    };
    setTimeout(() => document.addEventListener('click', outsideClickHandler!), 0);

    escKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    document.addEventListener('keydown', escKeyHandler);
  };

  // Initialise once DOM is ready (fragments already injected by main-loader)
  init();
})();
