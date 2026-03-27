/**
 * messages-area.ts — Shared message-rendering component.
 *
 * Provides createBasicMessageElement and createActionToolbar used by both
 * text channels (message-service.ts) and DM channels (direct-messaging-ui.ts).
 *
 * Load order: must appear in main-loader BEFORE message-service.js and
 * direct-messaging-ui.js.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger('MessagesArea');
  const emberCrypto = window.electronAPI.crypto;

  type GetEmberKey = (channelId: string) => Promise<Uint8Array | null>;

  function base64ToUint8Array(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function toAB(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async function decryptWithAttachmentKey(
    encryptedBase64: string,
    keyB64: string,
    ivB64: string
  ): Promise<Uint8Array> {
    const encryptedBytes = base64ToUint8Array(encryptedBase64);
    const keyBytes = base64ToUint8Array(keyB64);
    const ivBytes = base64ToUint8Array(ivB64);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      toAB(keyBytes),
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toAB(ivBytes), tagLength: 128 },
      cryptoKey,
      toAB(encryptedBytes)
    );
    return new Uint8Array(decrypted);
  }

  // ─── Spoiler persistence ────────────────────────────────────────────────────

  const SPOILER_STORAGE_KEY = 'ember:spoiler-revealed';
  const MAX_SPOILER_RECORDS = 1000;

  function isSpoilerRevealed(messageId: string): boolean {
    try {
      const raw = localStorage.getItem(SPOILER_STORAGE_KEY);
      if (!raw) return false;
      const ids: string[] = JSON.parse(raw);
      return ids.includes(messageId);
    } catch {
      return false;
    }
  }

  function markSpoilerRevealed(messageId: string): void {
    try {
      const raw = localStorage.getItem(SPOILER_STORAGE_KEY);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      if (ids.includes(messageId)) return;
      ids.push(messageId);
      if (ids.length > MAX_SPOILER_RECORDS) ids.splice(0, ids.length - MAX_SPOILER_RECORDS);
      localStorage.setItem(SPOILER_STORAGE_KEY, JSON.stringify(ids));
    } catch {
      // localStorage unavailable (e.g. private browsing)
    }
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  function toChumhandle(username: string): string {
    const words = username.match(/[A-Z]?[a-z]+|[0-9]+|[A-Z]+/g) || [username];

    // Extract letters from the beginning of each word
    let handle = '';
    for (let i = 0; i < words.length && handle.length < 4; i++) {
      const word = words[i];
      // Take up to 2 letters from each word to reach 4 total
      const lettersNeeded = Math.min(4 - handle.length, word.length);
      handle += word.slice(0, lettersNeeded).toUpperCase();
    }

    // If we couldn't get 4 letters from word beginnings, take more from the username
    if (handle.length < 4) {
      const remaining = username.slice(handle.length);
      const lettersNeeded = Math.min(4 - handle.length, remaining.length);
      handle += remaining.slice(0, lettersNeeded).toUpperCase();
    }

    return handle;
  }

  function formatTimestamp(unixSeconds?: number): string {
    const date = unixSeconds ? new Date(unixSeconds * 1000) : new Date();
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    if (isToday) return `Today at ${timeStr}`;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${timeStr}`;
    return `${date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })} at ${timeStr}`;
  }

  function formatRelativeTimestamp(unixSeconds?: number): string {
    if (!unixSeconds) return formatTimestamp();
    const now = Math.floor(Date.now() / 1000);
    const diff = now - unixSeconds;

    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;

    return formatTimestamp(unixSeconds);
  }

  // ─── Timestamp tooltip management ───────────────────────────────────────────────

  let activeTooltip: HTMLElement | null = null;
  let tooltipTimeout: number | null = null;

  function createTimestampTooltip(timestamp: number): HTMLElement {
    const tooltip = document.createElement('div');
    tooltip.className = 'message-timestamp-tooltip';

    const relativeTime = document.createElement('div');
    relativeTime.className = 'tooltip-relative-time';
    relativeTime.textContent = formatRelativeTimestamp(timestamp);

    const absoluteTime = document.createElement('div');
    absoluteTime.className = 'tooltip-absolute-time';
    absoluteTime.textContent = formatTimestamp(timestamp);

    tooltip.appendChild(relativeTime);
    tooltip.appendChild(absoluteTime);

    return tooltip;
  }

  function showTimestampTooltip(messageElement: HTMLElement, timestamp: number): void {
    // Clear any existing timeout
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
      tooltipTimeout = null;
    }

    // Remove existing tooltip
    if (activeTooltip && activeTooltip.parentNode) {
      activeTooltip.parentNode.removeChild(activeTooltip);
      activeTooltip = null;
    }

    // Create new tooltip
    const tooltip = createTimestampTooltip(timestamp);
    activeTooltip = tooltip;

    // Add to document temporarily to measure dimensions
    tooltip.style.visibility = 'hidden';
    tooltip.style.position = 'absolute';
    tooltip.style.top = '0';
    tooltip.style.left = '0';
    tooltip.style.zIndex = '1000';
    document.body.appendChild(tooltip);

    // Position tooltip
    const rect = messageElement.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    // Try to position above the message first
    let top = rect.top + scrollTop - tooltip.offsetHeight - 8;
    let left = rect.left + scrollLeft + rect.width / 2 - tooltip.offsetWidth / 2;

    // If tooltip would go above viewport, position below instead
    if (top < scrollTop + 10) {
      top = rect.bottom + scrollTop + 8;
    }

    // Ensure tooltip stays within viewport horizontally
    if (left < scrollLeft + 10) {
      left = scrollLeft + 10;
    } else if (left + tooltip.offsetWidth > scrollLeft + window.innerWidth - 10) {
      left = scrollLeft + window.innerWidth - tooltip.offsetWidth - 10;
    }

    // Apply final position
    tooltip.style.visibility = 'visible';
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    // Add a small delay before showing to prevent flickering
    tooltipTimeout = setTimeout(() => {
      tooltip.classList.add('visible');
    }, 100) as unknown as number;
  }

  function hideTimestampTooltip(): void {
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
      tooltipTimeout = null;
    }

    if (activeTooltip && activeTooltip.parentNode) {
      activeTooltip.parentNode.removeChild(activeTooltip);
      activeTooltip = null;
    }
  }

  // Cleanup function to prevent memory leaks
  function cleanupTimestampTooltips(): void {
    hideTimestampTooltip();
  }

  // Add cleanup on page unload
  window.addEventListener('beforeunload', cleanupTimestampTooltips);

  function isImageMime(mime: string): boolean {
    return typeof mime === 'string' && mime.startsWith('image/');
  }

  // ─── URL detection ─────────────────────────────────────────────────────────

  const IMAGE_URL_REGEX = /^https?:\/\/.+\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?[^\s]*)?$/i;

  function isImageUrl(url: string): boolean {
    return IMAGE_URL_REGEX.test(url);
  }

  function createUrlImageCard(url: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'url-image-card';

    const img = document.createElement('img');
    img.className = 'url-image-img';
    img.loading = 'lazy';
    img.alt = 'Image';

    img.onerror = () => {
      wrapper.className = 'url-image-card url-image-card-error';
      const errSpan = document.createElement('span');
      errSpan.textContent = '[failed to load image]';
      wrapper.replaceChildren(errSpan);
    };

    img.onload = () => {
      img.addEventListener('click', () => {
        (window as any).openImageViewer?.(url, url);
      });
      const scrollContainer = img.closest('.messages-container, #messages') as HTMLElement | null;
      if (scrollContainer) {
        const dist =
          scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
        const expanded = Math.max(0, (img.offsetHeight || 300) - 80);
        if (dist <= expanded + 60) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
    };

    img.src = url;
    wrapper.appendChild(img);
    return wrapper;
  }

  // ─── Markdown types ──────────────────────────────────────────────────────────

  type InlineToken =
    | { type: 'text'; value: string }
    | { type: 'url'; value: string }
    | { type: 'bold'; children: InlineToken[] }
    | { type: 'italic'; children: InlineToken[] }
    | { type: 'strike'; children: InlineToken[] }
    | { type: 'code'; value: string }
    | { type: 'spoiler'; children: InlineToken[] }
    | { type: 'mention'; userId: string };

  type Block =
    | { type: 'paragraph'; text: string }
    | { type: 'heading'; level: number; text: string }
    | { type: 'codeblock'; code: string }
    | { type: 'ul'; items: string[] }
    | { type: 'ol'; items: string[] }
    | { type: 'blockquote'; text: string };

  // ─── Inline tokenizer ─────────────────────────────────────────────────────

  function scanUrlEnd(text: string, start: number): number {
    let end = start;
    while (end < text.length && !/[\s<>"']/.test(text[end])) end++;
    return end;
  }

  function tokenizeInline(text: string): InlineToken[] {
    const tokens: InlineToken[] = [];
    let i = 0;

    function pushText(value: string): void {
      const last = tokens[tokens.length - 1];
      if (last && last.type === 'text') {
        last.value += value;
      } else {
        tokens.push({ type: 'text', value });
      }
    }

    while (i < text.length) {
      // Code span: `...`
      if (text[i] === '`') {
        const closingTick = text.indexOf('`', i + 1);
        if (closingTick !== -1) {
          tokens.push({ type: 'code', value: text.slice(i + 1, closingTick) });
          i = closingTick + 1;
          continue;
        }
      }

      // Bold: **...**
      if (text[i] === '*' && text[i + 1] === '*') {
        const closingBold = text.indexOf('**', i + 2);
        if (closingBold !== -1) {
          tokens.push({ type: 'bold', children: tokenizeInline(text.slice(i + 2, closingBold)) });
          i = closingBold + 2;
          continue;
        }
      }

      // Strikethrough: ~~...~~
      if (text[i] === '~' && text[i + 1] === '~') {
        const closingStrike = text.indexOf('~~', i + 2);
        if (closingStrike !== -1) {
          tokens.push({
            type: 'strike',
            children: tokenizeInline(text.slice(i + 2, closingStrike)),
          });
          i = closingStrike + 2;
          continue;
        }
      }

      // Spoiler: ||...||
      if (text[i] === '|' && text[i + 1] === '|') {
        const closingSpoiler = text.indexOf('||', i + 2);
        if (closingSpoiler !== -1) {
          tokens.push({
            type: 'spoiler',
            children: tokenizeInline(text.slice(i + 2, closingSpoiler)),
          });
          i = closingSpoiler + 2;
          continue;
        }
      }

      // Italic: *...* (not preceded or followed by *)
      if (text[i] === '*' && text[i + 1] !== '*') {
        let closingItalic = -1;
        for (let j = i + 1; j < text.length; j++) {
          if (text[j] === '*' && text[j + 1] !== '*') {
            closingItalic = j;
            break;
          }
        }
        if (closingItalic !== -1) {
          tokens.push({
            type: 'italic',
            children: tokenizeInline(text.slice(i + 1, closingItalic)),
          });
          i = closingItalic + 1;
          continue;
        }
      }

      // URL
      if (text.startsWith('https://', i) || text.startsWith('http://', i)) {
        const urlEnd = scanUrlEnd(text, i);
        tokens.push({ type: 'url', value: text.slice(i, urlEnd) });
        i = urlEnd;
        continue;
      }

      // Mention: <@userId> — userId is a UUID (36 chars)
      if (text[i] === '<' && text[i + 1] === '@') {
        const closingBracket = text.indexOf('>', i + 2);
        if (closingBracket !== -1 && closingBracket - (i + 2) <= 36) {
          const userId = text.slice(i + 2, closingBracket);
          tokens.push({ type: 'mention', userId });
          i = closingBracket + 1;
          continue;
        }
      }

      // Plain text — accumulate until next special character
      const start = i;
      while (i < text.length) {
        if (text[i] === '`') break;
        if (text[i] === '*') break;
        if (text[i] === '~' && text[i + 1] === '~') break;
        if (text[i] === '|' && text[i + 1] === '|') break;
        if (text[i] === '<' && text[i + 1] === '@') break;
        if (text.startsWith('https://', i) || text.startsWith('http://', i)) break;
        i++;
      }
      if (i > start) {
        pushText(text.slice(start, i));
      } else {
        // Unmatched special char — consume as literal text
        pushText(text[i]);
        i++;
      }
    }

    return tokens;
  }

  // ─── Inline renderer ──────────────────────────────────────────────────────

  function renderInlineTokens(tokens: InlineToken[], container: HTMLElement): void {
    for (const token of tokens) {
      if (token.type === 'text') {
        container.appendChild(document.createTextNode(token.value));
      } else if (token.type === 'url') {
        if (isImageUrl(token.value)) {
          container.appendChild(createUrlImageCard(token.value));
        } else {
          const link = document.createElement('a');
          link.className = 'message-link';
          link.textContent = token.value;
          link.href = '#';
          link.addEventListener('click', e => {
            e.preventDefault();
            (window as any).openExternalLinkModal?.(token.value);
          });
          container.appendChild(link);
        }
      } else if (token.type === 'bold') {
        const el = document.createElement('strong');
        renderInlineTokens(token.children, el);
        container.appendChild(el);
      } else if (token.type === 'italic') {
        const el = document.createElement('em');
        renderInlineTokens(token.children, el);
        container.appendChild(el);
      } else if (token.type === 'strike') {
        const el = document.createElement('s');
        renderInlineTokens(token.children, el);
        container.appendChild(el);
      } else if (token.type === 'code') {
        const el = document.createElement('code');
        el.textContent = token.value;
        container.appendChild(el);
      } else if (token.type === 'spoiler') {
        const span = document.createElement('span');
        span.className = 'spoiler-text';
        span.dataset['revealed'] = 'false';
        span.setAttribute('aria-label', 'Spoiler — click to reveal');
        span.addEventListener('click', () => {
          span.dataset['revealed'] = 'true';
          span.classList.add('spoiler-text--revealed');
        });
        renderInlineTokens(token.children, span);
        container.appendChild(span);
      } else if (token.type === 'mention') {
        const span = document.createElement('span');
        span.className = 'message-mention';
        span.dataset['userId'] = token.userId;
        const member = App.currentMembers?.find(
          (m: { userId: string }) => m.userId === token.userId
        );
        span.textContent = `@${member?.username ?? token.userId.slice(0, 8)}`;
        (window as any).makeUsernameClickable?.(span, token.userId, span.textContent.slice(1));
        container.appendChild(span);
      }
    }
  }

  // ─── Block parser ─────────────────────────────────────────────────────────

  function parseBlocks(text: string): Block[] {
    const blocks: Block[] = [];
    const lines = text.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Code fence: ```
      if (line.startsWith('```')) {
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // consume closing ```
        blocks.push({ type: 'codeblock', code: codeLines.join('\n') });
        continue;
      }

      // Heading: # to ######
      const hMatch = /^(#{1,6})\s+(.+)$/.exec(line);
      if (hMatch) {
        blocks.push({ type: 'heading', level: hMatch[1].length, text: hMatch[2] });
        i++;
        continue;
      }

      // Unordered list: - item or * item
      if (/^[-*]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^[-*]\s+/, ''));
          i++;
        }
        blocks.push({ type: 'ul', items });
        continue;
      }

      // Ordered list: 1. item
      if (/^\d+\.\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\d+\.\s+/, ''));
          i++;
        }
        blocks.push({ type: 'ol', items });
        continue;
      }

      // Blockquote: > text
      if (line.startsWith('> ')) {
        const qLines: string[] = [];
        while (i < lines.length && lines[i].startsWith('> ')) {
          qLines.push(lines[i].slice(2));
          i++;
        }
        blocks.push({ type: 'blockquote', text: qLines.join('\n') });
        continue;
      }

      // Blank line — skip
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Paragraph — accumulate consecutive non-special lines
      const pLines: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (
          l.startsWith('```') ||
          /^#{1,6}\s/.test(l) ||
          /^[-*]\s/.test(l) ||
          /^\d+\.\s/.test(l) ||
          l.startsWith('> ') ||
          l.trim() === ''
        )
          break;
        pLines.push(l);
        i++;
      }
      if (pLines.length > 0) {
        blocks.push({ type: 'paragraph', text: pLines.join('\n') });
      }
    }

    return blocks;
  }

  // ─── Block renderer ───────────────────────────────────────────────────────

  function renderBlock(block: Block, container: HTMLElement): void {
    if (block.type === 'paragraph') {
      const p = document.createElement('p');
      renderInlineTokens(tokenizeInline(block.text), p);
      container.appendChild(p);
    } else if (block.type === 'heading') {
      const level = Math.min(block.level, 6);
      const tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      const h = document.createElement(tag);
      renderInlineTokens(tokenizeInline(block.text), h);
      container.appendChild(h);
    } else if (block.type === 'codeblock') {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.code;
      pre.appendChild(code);
      container.appendChild(pre);
    } else if (block.type === 'ul') {
      const ul = document.createElement('ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        renderInlineTokens(tokenizeInline(item), li);
        ul.appendChild(li);
      }
      container.appendChild(ul);
    } else if (block.type === 'ol') {
      const ol = document.createElement('ol');
      for (const item of block.items) {
        const li = document.createElement('li');
        renderInlineTokens(tokenizeInline(item), li);
        ol.appendChild(li);
      }
      container.appendChild(ol);
    } else if (block.type === 'blockquote') {
      const bq = document.createElement('blockquote');
      const p = document.createElement('p');
      renderInlineTokens(tokenizeInline(block.text), p);
      bq.appendChild(p);
      container.appendChild(bq);
    }
  }

  // ─── Markdown renderer (replaces renderTextWithLinks) ─────────────────────

  function renderMarkdownWithLinks(text: string, container: HTMLElement): void {
    if (!text) return;

    const blocks = parseBlocks(text);
    if (blocks.length === 0) return;

    // Single paragraph: render inline to preserve terminal-log display style
    if (blocks.length === 1 && blocks[0].type === 'paragraph') {
      renderInlineTokens(tokenizeInline(blocks[0].text), container);
      return;
    }

    // Block-level content: switch container to block display
    container.classList.add('message-text--block');
    for (const block of blocks) {
      renderBlock(block, container);
    }
  }

  // ─── GIF card ──────────────────────────────────────────────────────────────

  function createGifCard(gifData: { url: string; title?: string }): HTMLElement {
    const card = document.createElement('div');
    card.className = 'gif-card';
    const img = document.createElement('img');
    img.src = gifData.url;
    img.alt = gifData.title || 'GIF';
    img.loading = 'lazy';
    img.addEventListener('click', () => {
      (window as any).openImageViewer?.(gifData.url, gifData.title || 'GIF');
    });
    card.appendChild(img);
    return card;
  }

  // ─── Attachment loading and downloading ────────────────────────────────────

  function showImageBlob(
    bytes: Uint8Array,
    attachment: AttachmentData,
    img: HTMLImageElement,
    statusEl: HTMLElement,
    wrapper: HTMLElement
  ): void {
    const blob = new Blob(
      [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
      { type: attachment.mime || 'image/png' }
    );
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      wrapper.className = 'image-card-wrapper image-card-state-loaded';
      img.addEventListener('click', () => {
        (window as any).openImageViewer?.(url, attachment.name);
      });
      const scrollContainer = img.closest('.messages-container, #messages') as HTMLElement | null;
      if (scrollContainer) {
        const dist =
          scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
        const expanded = Math.max(0, (img.offsetHeight || 300) - 80);
        if (dist <= expanded + 60) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
    };
    img.onerror = () => {
      statusEl.textContent = '[failed to load image]';
      wrapper.className = 'image-card-wrapper image-card-state-error';
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function loadImageForCard(
    attachment: AttachmentData,
    img: HTMLImageElement,
    statusEl: HTMLElement,
    wrapper: HTMLElement,
    channelId: string,
    getEmberKey: GetEmberKey
  ): void {
    const setError = (): void => {
      statusEl.textContent = '[failed to load image]';
      wrapper.className = 'image-card-wrapper image-card-state-error';
    };

    ipcRenderer
      .invoke('get-auth')
      .then((authUnknown: unknown) => {
        const auth = authUnknown as AuthData | null;
        if (!auth) {
          setError();
          return;
        }
        window.electronAPI.messageService
          .downloadAttachment(auth, channelId, attachment.id)
          .then(async resp => {
            if (attachment.key && attachment.iv) {
              const bytes = await decryptWithAttachmentKey(
                resp.encryptedData,
                attachment.key,
                attachment.iv
              );
              showImageBlob(bytes, attachment, img, statusEl, wrapper);
            } else {
              const emberKey = await getEmberKey(channelId);
              if (!emberKey) {
                log.error('Cannot load image: no ember key and no per-attachment key', {
                  id: attachment.id,
                });
                setError();
                return;
              }
              const bytes = emberCrypto.decryptFileBytes(resp.encryptedData, emberKey);
              if (!bytes) {
                log.error('Failed to decrypt image attachment', { id: attachment.id });
                setError();
                return;
              }
              showImageBlob(new Uint8Array(bytes), attachment, img, statusEl, wrapper);
            }
          })
          .catch((err: Error) => {
            setError();
            log.error('Failed to download image attachment', {
              id: attachment.id,
              error: err.message,
            });
          });
      })
      .catch((err: Error) => {
        setError();
        log.error('Failed to get auth for image', { error: err.message });
      });
  }

  function downloadAttachmentFile(
    attachment: AttachmentData,
    channelId: string,
    getEmberKey: GetEmberKey
  ): void {
    ipcRenderer
      .invoke('get-auth')
      .then(async (authUnknown: unknown) => {
        const auth = authUnknown as AuthData | null;
        if (!auth) return;
        const resp = await window.electronAPI.messageService.downloadAttachment(
          auth,
          channelId,
          attachment.id
        );

        let decryptedBytes: Uint8Array;
        if (attachment.key && attachment.iv) {
          decryptedBytes = await decryptWithAttachmentKey(
            resp.encryptedData,
            attachment.key,
            attachment.iv
          );
        } else {
          const emberKey = await getEmberKey(channelId);
          if (!emberKey) {
            log.error('Cannot download: no ember key and no per-attachment key', {
              id: attachment.id,
            });
            return;
          }
          const bytes = emberCrypto.decryptFileBytes(resp.encryptedData, emberKey);
          if (!bytes) {
            log.error('Failed to decrypt attachment', { id: attachment.id });
            return;
          }
          decryptedBytes = new Uint8Array(bytes);
        }

        const blob = new Blob(
          [
            decryptedBytes.buffer.slice(
              decryptedBytes.byteOffset,
              decryptedBytes.byteOffset + decryptedBytes.byteLength
            ) as ArrayBuffer,
          ],
          {
            type: resp.contentType || 'application/octet-stream',
          }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = resp.originalName;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((err: Error) => {
        log.error('Failed to download attachment', {
          id: attachment.id,
          error: err.message,
        });
      });
  }

  function createImageCard(
    attachment: AttachmentData,
    channelId: string,
    getEmberKey: GetEmberKey
  ): HTMLElement {
    const card = document.createElement('div');
    card.className = 'image-card';

    const imgWrapper = document.createElement('div');

    const statusEl = document.createElement('span');
    statusEl.className = 'image-card-status';
    statusEl.textContent = '[loading...]';

    const img = document.createElement('img');
    img.className = 'image-card-img';
    img.alt = attachment.name;

    const footer = document.createElement('div');
    footer.className = 'image-card-footer';

    const nameEl = document.createElement('span');
    nameEl.className = 'image-card-name';
    nameEl.textContent = attachment.name;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'file-card-download';
    saveBtn.textContent = '[save]';
    saveBtn.addEventListener('click', () => {
      downloadAttachmentFile(attachment, channelId, getEmberKey);
    });

    footer.appendChild(nameEl);
    footer.appendChild(saveBtn);

    if (attachment.spoiler) {
      // Wrapper IS the spoiler overlay — defers image load until revealed.
      imgWrapper.className = 'image-card-wrapper spoiler-image-overlay';
      const label = document.createElement('span');
      label.className = 'spoiler-image-label';
      label.textContent = '🔒 SPOILER — click to reveal';
      imgWrapper.appendChild(label);
      imgWrapper.appendChild(statusEl);
      imgWrapper.appendChild(img);
      imgWrapper.addEventListener(
        'click',
        () => {
          imgWrapper.classList.remove('spoiler-image-overlay');
          imgWrapper.classList.add('image-card-state-loading', 'spoiler-image-overlay--revealed');
          imgWrapper.removeChild(label);
          loadImageForCard(attachment, img, statusEl, imgWrapper, channelId, getEmberKey);
        },
        { once: true }
      );
    } else {
      imgWrapper.className = 'image-card-wrapper image-card-state-loading';
      imgWrapper.appendChild(statusEl);
      imgWrapper.appendChild(img);
      loadImageForCard(attachment, img, statusEl, imgWrapper, channelId, getEmberKey);
    }

    card.appendChild(imgWrapper);
    card.appendChild(footer);

    return card;
  }

  function createFileCard(
    attachment: AttachmentData,
    channelId: string,
    getEmberKey: GetEmberKey
  ): HTMLElement {
    if (isImageMime(attachment.mime)) {
      return createImageCard(attachment, channelId, getEmberKey);
    }
    const card = document.createElement('div');
    card.className = 'file-card';

    const icon = document.createElement('span');
    icon.className = 'file-card-icon';
    icon.textContent = '📎 ';

    const nameEl = document.createElement('span');
    nameEl.className = 'file-card-name';
    nameEl.textContent = attachment.name;

    const dlBtn = document.createElement('button');
    dlBtn.className = 'file-card-download';
    dlBtn.textContent = '[download]';
    dlBtn.addEventListener('click', () => {
      downloadAttachmentFile(attachment, channelId, getEmberKey);
    });

    card.appendChild(icon);
    card.appendChild(nameEl);
    card.appendChild(dlBtn);
    return card;
  }

  // ─── Action toolbar ────────────────────────────────────────────────────────

  function createActionButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'message-action-btn';
    btn.title = title;
    btn.textContent = icon;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  /**
   * Configure and show the delete-confirm modal for a message deletion.
   */
  function showDeleteMessageModal(messageId: string, channelId: string): void {
    (window as any).pendingMessageDelete = { messageId, channelId };
    const titleEl = document.getElementById('delete-modal-title');
    const msgEl = document.getElementById('delete-modal-message');
    if (titleEl) titleEl.textContent = 'Delete Message';
    if (msgEl)
      msgEl.textContent = 'Are you sure you want to delete this message? This cannot be undone.';
    document.getElementById('delete-confirm-modal')?.classList.remove('hidden');
  }

  /**
   * Build the hover action toolbar.
   *
   * @param messageId - The message ID (used for ownedMessageIds lookup and edit).
   * @param isOwn     - Explicit ownership override. If omitted, falls back to
   *                    App.ownedMessageIds (text-channel messages only).
   */
  function createActionToolbar(messageId?: string, isOwn?: boolean): HTMLDivElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'message-action-bar';

    // Prefer explicit isOwn; fall back to App.ownedMessageIds for text channels.
    const owned = isOwn !== undefined ? isOwn : !!messageId && App.ownedMessageIds.has(messageId);

    if (owned) {
      toolbar.appendChild(
        createActionButton('✏', 'Edit', () => {
          const msgDiv = toolbar.closest('.message') as HTMLElement | null;
          if (msgDiv && messageId) {
            const enterEdit = (window as any).enterEditMode as
              | ((div: HTMLElement, id: string) => void)
              | undefined;
            enterEdit?.(msgDiv, messageId);
          }
        })
      );

      toolbar.appendChild(
        createActionButton('🗑', 'Delete', () => {
          if (messageId) {
            const channelId = App.activeChannelId ?? '';
            showDeleteMessageModal(messageId, channelId);
          }
        })
      );
    }

    return toolbar;
  }

  // ─── Message element builder ───────────────────────────────────────────────

  /**
   * Build a single message DOM element.
   *
   * @param author       - Display name for the sender.
   * @param text         - Decrypted plaintext body (may be "" for attachment/GIF-only messages).
   * @param timestamp    - Unix seconds.
   * @param messageId    - Used for data-message-id and action toolbar.
   * @param chatColor    - Optional custom chat colour.
   * @param isOwn        - True if the message was sent by the current user.
   * @param attachment   - Parsed attachment metadata (from `{"t":"file",...}`).
   * @param gif          - Parsed GIF metadata (from `{"t":"gif",...}`).
   * @param channelId    - Channel ID used for attachment download/decryption.
   * @param getEmberKey  - Async callback that resolves the ember key for the channel.
   */
  function createBasicMessageElement(
    author: string,
    text: string,
    timestamp?: number,
    messageId?: string,
    chatColor?: string,
    isOwn?: boolean,
    attachment?: AttachmentData,
    gif?: { url: string; title?: string },
    channelId?: string,
    getEmberKey?: GetEmberKey
  ): HTMLElement {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    if (messageId) messageDiv.dataset['messageId'] = messageId;
    if (isOwn) messageDiv.classList.add('own');
    if (chatColor) messageDiv.style.color = chatColor;

    const avatarEl = document.createElement('div');
    avatarEl.className = 'message-avatar';
    avatarEl.textContent = author.charAt(0).toUpperCase();

    // Real DOM element for the chumhandle prefix — replaces the CSS ::before pseudo-element
    // so that it can receive click events to open the user details modal.
    // userId is NOT looked up here to avoid a race condition where currentMembers hasn't
    // loaded yet. openUserDetailsModal resolves the userId lazily at click time.
    const chumhandleEl = document.createElement('span');
    chumhandleEl.className = 'message-chumhandle';
    chumhandleEl.textContent = `[${toChumhandle(author)}]: `;
    (window as any).makeUsernameClickable?.(chumhandleEl, '', author);

    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';

    const headerEl = document.createElement('div');
    headerEl.className = 'message-header';

    const authorEl = document.createElement('span');
    authorEl.className = 'message-author';
    authorEl.textContent = author;

    const tsEl = document.createElement('span');
    tsEl.className = 'message-timestamp';
    tsEl.textContent = formatTimestamp(timestamp);

    headerEl.appendChild(authorEl);
    headerEl.appendChild(tsEl);

    const textEl = document.createElement('div');
    textEl.className = 'message-text';
    renderMarkdownWithLinks(text, textEl);

    contentEl.appendChild(headerEl);
    contentEl.appendChild(textEl);
    messageDiv.appendChild(chumhandleEl);
    messageDiv.appendChild(avatarEl);
    messageDiv.appendChild(contentEl);

    if (attachment && channelId && getEmberKey) {
      messageDiv.appendChild(createFileCard(attachment, channelId, getEmberKey));
    }

    if (gif) {
      messageDiv.appendChild(createGifCard(gif));
    }

    messageDiv.appendChild(createActionToolbar(messageId, isOwn));

    // ── Spoiler persistence ─────────────────────────────────────────────────
    if (messageId) {
      const alreadyRevealed = isSpoilerRevealed(messageId);

      // Wire text spoiler spans
      messageDiv.querySelectorAll<HTMLElement>('.spoiler-text').forEach(span => {
        if (alreadyRevealed) {
          span.dataset['revealed'] = 'true';
          span.classList.add('spoiler-text--revealed');
        }
        span.addEventListener('click', () => markSpoilerRevealed(messageId));
      });

      // Wire image spoiler overlay
      const imgOverlay = messageDiv.querySelector<HTMLElement>('.spoiler-image-overlay');
      if (imgOverlay) {
        imgOverlay.addEventListener('click', () => markSpoilerRevealed(messageId));
        if (alreadyRevealed) {
          // Programmatically reveal: triggers the { once } load listener
          imgOverlay.click();
        }
      }
    }

    // Add timestamp hover functionality if timestamp is available
    if (timestamp) {
      messageDiv.addEventListener('mouseenter', () => {
        showTimestampTooltip(messageDiv, timestamp);
      });

      messageDiv.addEventListener('mouseleave', () => {
        hideTimestampTooltip();
      });
    }

    return messageDiv;
  }

  // ─── Mention resolution ────────────────────────────────────────────────────

  function resolveMentions(text: string): string {
    return text.replace(/@(\w{3,20})/g, (match, username) => {
      const member = App.currentMembers?.find((m: { username: string }) => m.username === username);
      return member ? `<@${member.userId}>` : match;
    });
  }

  // ─── Expose globals ────────────────────────────────────────────────────────

  window.createBasicMessageElement = createBasicMessageElement;
  window.createActionToolbar = createActionToolbar;
  window.formatTimestamp = formatTimestamp;
  window.formatRelativeTimestamp = formatRelativeTimestamp;
  window.toChumhandle = toChumhandle;
  (window as any).resolveMentions = resolveMentions;
})();
