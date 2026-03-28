/**
 * Unit tests for src/renderer/components/messages-area.ts
 *
 * Tests URL detection and rendering in createBasicMessageElement:
 *   - Plain text creates no link elements
 *   - HTTP URLs create .message-link anchor elements
 *   - Image URLs (.png, .jpg, .gif, .webp) create .url-image-card elements
 *   - Mixed text+URL preserves surrounding text
 *   - Multiple URLs in one message all rendered
 */

// @jest-environment jsdom

beforeAll(() => {
  // 1. Populate window.App
  require('../../../src/renderer/managers/app-state');

  // 2. Mock window.electronAPI
  (window as any).electronAPI = {
    ipc: {
      invoke: jest.fn().mockResolvedValue(null),
      send: jest.fn(),
      on: jest.fn(),
    },
    crypto: {
      decryptFileBytes: jest.fn(),
    },
    messageService: {
      downloadAttachment: jest.fn(),
    },
    nacl: {},
    naclUtil: {},
  };

  // 3. Mock window.emberLog
  (window as any).emberLog = {
    createLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  };

  // 4. Mock openExternalLinkModal
  (window as any).openExternalLinkModal = jest.fn();

  // 5. Mock openImageViewer
  (window as any).openImageViewer = jest.fn();

  // 6. Mock user-service and username-click-handler globals
  (window as any).getUserDetailsByUsername = jest.fn().mockReturnValue(null);
  (window as any).makeUsernameClickable = jest.fn().mockImplementation((el: HTMLElement) => {
    el.classList.add('username-clickable');
  });
  (window as any).openUserDetailsModal = jest.fn();

  // 7. Load the IIFE module
  require('../../../src/renderer/components/messages-area');
});

describe('createBasicMessageElement — URL rendering', () => {
  function createElement(text: string): HTMLElement {
    return window.createBasicMessageElement('Alice', text, undefined, 'msg1');
  }

  function getTextEl(el: HTMLElement): HTMLElement {
    return el.querySelector('.message-text') as HTMLElement;
  }

  it('renders plain text without any link or image elements', () => {
    const el = createElement('Hello world');
    const textEl = getTextEl(el);
    expect(textEl.querySelector('a')).toBeNull();
    expect(textEl.querySelector('.url-image-card')).toBeNull();
    expect(textEl.textContent).toBe('Hello world');
  });

  it('renders an http URL as a .message-link anchor', () => {
    const el = createElement('Visit https://example.com for info');
    const textEl = getTextEl(el);
    const link = textEl.querySelector('a.message-link') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('https://example.com');
    expect(link.getAttribute('href')).toBe('#');
  });

  it('renders text surrounding the URL correctly', () => {
    const el = createElement('Before https://example.com after');
    const textEl = getTextEl(el);
    const fullText = textEl.textContent;
    expect(fullText).toContain('Before ');
    expect(fullText).toContain(' after');
    expect(fullText).toContain('https://example.com');
  });

  it('clicking .message-link calls openExternalLinkModal with the URL', () => {
    const mockOpenModal = jest.fn();
    (window as any).openExternalLinkModal = mockOpenModal;

    const el = createElement('See https://example.com here');
    const link = el.querySelector('a.message-link') as HTMLAnchorElement;
    expect(link).not.toBeNull();

    link.click();

    expect(mockOpenModal).toHaveBeenCalledWith('https://example.com');
  });

  it('renders a .png URL as a .url-image-card', () => {
    const el = createElement('https://example.com/photo.png');
    const textEl = getTextEl(el);
    const imgCard = textEl.querySelector('.url-image-card');
    expect(imgCard).not.toBeNull();
    expect(textEl.querySelector('a.message-link')).toBeNull();
  });

  it('renders a .jpg URL as a .url-image-card', () => {
    const el = createElement('https://example.com/image.jpg');
    const textEl = getTextEl(el);
    expect(textEl.querySelector('.url-image-card')).not.toBeNull();
  });

  it('renders a .gif URL as a .url-image-card', () => {
    const el = createElement('https://example.com/anim.gif');
    const textEl = getTextEl(el);
    expect(textEl.querySelector('.url-image-card')).not.toBeNull();
  });

  it('renders a .webp URL as a .url-image-card', () => {
    const el = createElement('https://example.com/img.webp');
    const textEl = getTextEl(el);
    expect(textEl.querySelector('.url-image-card')).not.toBeNull();
  });

  it('renders a .jpeg URL as a .url-image-card', () => {
    const el = createElement('https://example.com/photo.jpeg');
    const textEl = getTextEl(el);
    expect(textEl.querySelector('.url-image-card')).not.toBeNull();
  });

  it('url-image-card contains an img element with the correct src', () => {
    const url = 'https://example.com/photo.png';
    const el = createElement(url);
    const img = el.querySelector('.url-image-card img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe(url);
  });

  it('renders multiple URLs in one message', () => {
    const el = createElement('Check https://example.com and https://other.org/pic.png');
    const textEl = getTextEl(el);
    const links = textEl.querySelectorAll('a.message-link');
    const imgCards = textEl.querySelectorAll('.url-image-card');
    expect(links).toHaveLength(1);
    expect(imgCards).toHaveLength(1);
  });

  it('empty text produces empty message-text element', () => {
    const el = createElement('');
    const textEl = getTextEl(el);
    expect(textEl.textContent).toBe('');
    expect(textEl.childNodes.length).toBe(0);
  });

  it('URL with query string is rendered as a link', () => {
    const url = 'https://example.com/search?q=hello&page=1';
    const el = createElement(url);
    const textEl = getTextEl(el);
    const link = textEl.querySelector('a.message-link');
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe(url);
  });

  it('image URL with query string is still rendered as url-image-card', () => {
    const el = createElement('https://cdn.example.com/img.png?w=200');
    const textEl = getTextEl(el);
    expect(textEl.querySelector('.url-image-card')).not.toBeNull();
  });
});

describe('createBasicMessageElement — markdown inline rendering', () => {
  function createElement(text: string): HTMLElement {
    return window.createBasicMessageElement('Alice', text, undefined, 'msg-md');
  }

  function getTextEl(el: HTMLElement): HTMLElement {
    return el.querySelector('.message-text') as HTMLElement;
  }

  it('renders **bold** as <strong> element', () => {
    const el = createElement('Hello **world**');
    const strong = getTextEl(el).querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('world');
  });

  it('renders *italic* as <em> element', () => {
    const el = createElement('Hello *world*');
    const em = getTextEl(el).querySelector('em');
    expect(em).not.toBeNull();
    expect(em!.textContent).toBe('world');
  });

  it('renders `code` as <code> element', () => {
    const el = createElement('Use `console.log()`');
    const code = getTextEl(el).querySelector('code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('console.log()');
  });

  it('renders ~~strikethrough~~ as <s> element', () => {
    const el = createElement('This is ~~deleted~~ text');
    const s = getTextEl(el).querySelector('s');
    expect(s).not.toBeNull();
    expect(s!.textContent).toBe('deleted');
  });

  it('code span preserves literal content — **not bold** inside backticks', () => {
    const el = createElement('`**not bold**`');
    const textEl = getTextEl(el);
    const code = textEl.querySelector('code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('**not bold**');
    expect(textEl.querySelector('strong')).toBeNull();
  });

  it('renders URL inside bold as a link within <strong>', () => {
    const el = createElement('**Visit https://example.com now**');
    const strong = getTextEl(el).querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.querySelector('a.message-link')).not.toBeNull();
  });

  it('does not create a script element from XSS attempt', () => {
    const el = createElement('<script>alert(1)</script>');
    expect(el.querySelector('script')).toBeNull();
  });

  it('renders < and > as literal text, not HTML elements', () => {
    const el = createElement('<b>not a tag</b>');
    const textEl = getTextEl(el);
    expect(textEl.querySelector('b')).toBeNull();
    expect(textEl.textContent).toContain('<b>not a tag</b>');
  });

  it('renders plain text without any markdown elements', () => {
    const el = createElement('Just plain text');
    const textEl = getTextEl(el);
    expect(textEl.querySelector('strong, em, code, s')).toBeNull();
    expect(textEl.textContent).toBe('Just plain text');
  });
});

describe('createBasicMessageElement — markdown block rendering', () => {
  function createElement(text: string): HTMLElement {
    return window.createBasicMessageElement('Alice', text, undefined, 'msg-block');
  }

  function getTextEl(el: HTMLElement): HTMLElement {
    return el.querySelector('.message-text') as HTMLElement;
  }

  it('renders # Heading as <h1>', () => {
    const el = createElement('# Hello World');
    const h1 = getTextEl(el).querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toBe('Hello World');
  });

  it('renders ## Heading as <h2>', () => {
    const el = createElement('## Section Title');
    const h2 = getTextEl(el).querySelector('h2');
    expect(h2).not.toBeNull();
    expect(h2!.textContent).toBe('Section Title');
  });

  it('renders ### Heading as <h3>', () => {
    const el = createElement('### Subsection');
    expect(getTextEl(el).querySelector('h3')).not.toBeNull();
  });

  it('renders code block (triple backtick) as <pre><code>', () => {
    const el = createElement("```\nconsole.log('hello')\n```");
    const textEl = getTextEl(el);
    expect(textEl.querySelector('pre')).not.toBeNull();
    const code = textEl.querySelector('pre code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toContain('console.log');
  });

  it('code block content is literal — **not bold** inside fences', () => {
    const el = createElement('```\n**not bold**\n```');
    const textEl = getTextEl(el);
    const code = textEl.querySelector('pre code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toContain('**not bold**');
    expect(textEl.querySelector('strong')).toBeNull();
  });

  it('renders - list items as <ul><li>', () => {
    const el = createElement('- item one\n- item two\n- item three');
    const textEl = getTextEl(el);
    const ul = textEl.querySelector('ul');
    expect(ul).not.toBeNull();
    const items = ul!.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('item one');
    expect(items[1].textContent).toBe('item two');
  });

  it('renders 1. ordered list items as <ol><li>', () => {
    const el = createElement('1. first\n2. second\n3. third');
    const textEl = getTextEl(el);
    const ol = textEl.querySelector('ol');
    expect(ol).not.toBeNull();
    const items = ol!.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('first');
  });

  it('renders > blockquote as <blockquote>', () => {
    const el = createElement('> This is a quote');
    const textEl = getTextEl(el);
    const bq = textEl.querySelector('blockquote');
    expect(bq).not.toBeNull();
    expect(bq!.textContent).toContain('This is a quote');
  });

  it('adds message-text--block class for block-level content', () => {
    const el = createElement('# Heading');
    const textEl = getTextEl(el);
    expect(textEl.classList.contains('message-text--block')).toBe(true);
  });

  it('does not add message-text--block class for plain text', () => {
    const el = createElement('Just plain text');
    const textEl = getTextEl(el);
    expect(textEl.classList.contains('message-text--block')).toBe(false);
  });
});

describe('createActionToolbar', () => {
  beforeEach(() => {
    (window as any).App.ownedMessageIds = new Set<string>();
  });

  it('returns a div with class message-action-bar', () => {
    const toolbar = window.createActionToolbar('msg-1', false);
    expect(toolbar.tagName).toBe('DIV');
    expect(toolbar.className).toBe('message-action-bar');
  });

  it('does not include a react button', () => {
    const toolbar = window.createActionToolbar('msg-1', false);
    const buttons = toolbar.querySelectorAll('button');
    const titles = Array.from(buttons).map(b => b.title);
    expect(titles).not.toContain('Add Reaction');
  });

  it('does not include a forward button', () => {
    const toolbar = window.createActionToolbar('msg-1', false);
    const buttons = toolbar.querySelectorAll('button');
    const titles = Array.from(buttons).map(b => b.title);
    expect(titles).not.toContain('Forward');
  });

  it('does not include a delete button for non-owned messages (isOwn=false)', () => {
    const toolbar = window.createActionToolbar('msg-1', false);
    const buttons = toolbar.querySelectorAll('button');
    const titles = Array.from(buttons).map(b => b.title);
    expect(titles).not.toContain('Delete');
  });

  it('includes a delete button for owned messages (isOwn=true)', () => {
    const toolbar = window.createActionToolbar('msg-1', true);
    const buttons = toolbar.querySelectorAll('button');
    const titles = Array.from(buttons).map(b => b.title);
    expect(titles).toContain('Delete');
  });

  it('includes an edit button for owned messages (isOwn=true)', () => {
    const toolbar = window.createActionToolbar('msg-1', true);
    const buttons = toolbar.querySelectorAll('button');
    const titles = Array.from(buttons).map(b => b.title);
    expect(titles).toContain('Edit');
  });

  it('does not include an edit button for non-owned messages (isOwn=false)', () => {
    const toolbar = window.createActionToolbar('msg-1', false);
    const buttons = toolbar.querySelectorAll('button');
    const titles = Array.from(buttons).map(b => b.title);
    expect(titles).not.toContain('Edit');
  });

  it('falls back to App.ownedMessageIds when isOwn is omitted', () => {
    (window as any).App.ownedMessageIds.add('msg-owned');
    const toolbar = window.createActionToolbar('msg-owned');
    const buttons = toolbar.querySelectorAll('button');
    const titles = Array.from(buttons).map(b => b.title);
    expect(titles).toContain('Delete');
  });

  it('shows only the reaction button for non-owned messages when isOwn is omitted', () => {
    const toolbar = window.createActionToolbar('msg-not-owned');
    const buttons = toolbar.querySelectorAll('button');
    // Only the reaction "+" button should be present (no Edit/Delete)
    expect(buttons.length).toBe(1);
    expect(buttons[0].title).toBe('React');
  });
});

describe('createBasicMessageElement — chumhandle span', () => {
  it('renders a .message-chumhandle span with the correct chumhandle text', () => {
    const el = window.createBasicMessageElement('Alice', 'hello', undefined, 'msg-ch');
    const ch = el.querySelector('.message-chumhandle') as HTMLElement;
    expect(ch).not.toBeNull();
    // toChumhandle('Alice') → 'ALIC' (4-letter expansion)
    expect(ch.textContent).toBe('[ALIC]: ');
  });

  it('always calls makeUsernameClickable with empty userId to avoid race condition', () => {
    const mockMakeClickable = (window as any).makeUsernameClickable as jest.Mock;
    mockMakeClickable.mockClear();

    window.createBasicMessageElement('Alice', 'hello', undefined, 'msg-click');

    expect(mockMakeClickable).toHaveBeenCalledTimes(1);
    const [calledEl, calledId, calledName] = mockMakeClickable.mock.calls[0];
    expect(calledEl.classList.contains('message-chumhandle')).toBe(true);
    // userId is '' — resolved lazily in openUserDetailsModal at click time
    expect(calledId).toBe('');
    expect(calledName).toBe('Alice');
  });

  it('calls makeUsernameClickable even when currentMembers is empty', () => {
    const mockMakeClickable = (window as any).makeUsernameClickable as jest.Mock;
    mockMakeClickable.mockClear();
    (window as any).App.currentMembers = [];

    window.createBasicMessageElement('Unknown', 'hello', undefined, 'msg-unknown');

    expect(mockMakeClickable).toHaveBeenCalledTimes(1);
  });
});

describe('createBasicMessageElement — spoiler text (||...||)', () => {
  beforeEach(() => {
    localStorage.removeItem('ember:spoiler-revealed');
  });

  function createElement(text: string): HTMLElement {
    return window.createBasicMessageElement('Alice', text, undefined, 'msg-spoiler');
  }

  function getTextEl(el: HTMLElement): HTMLElement {
    return el.querySelector('.message-text') as HTMLElement;
  }

  it('renders ||spoiler|| as a .spoiler-text span', () => {
    const el = createElement('||hidden||');
    const textEl = getTextEl(el);
    const span = textEl.querySelector('.spoiler-text') as HTMLElement;
    expect(span).not.toBeNull();
  });

  it('spoiler text content is rendered inside the span', () => {
    const el = createElement('||secret||');
    const span = getTextEl(el).querySelector('.spoiler-text') as HTMLElement;
    expect(span.textContent).toBe('secret');
  });

  it('spoiler span starts unrevealed (data-revealed=false)', () => {
    const el = createElement('||hidden||');
    const span = getTextEl(el).querySelector('.spoiler-text') as HTMLElement;
    expect(span.dataset['revealed']).toBe('false');
    expect(span.classList.contains('spoiler-text--revealed')).toBe(false);
  });

  it('clicking spoiler span reveals content', () => {
    const el = createElement('||secret text||');
    const span = getTextEl(el).querySelector('.spoiler-text') as HTMLElement;
    span.click();
    expect(span.classList.contains('spoiler-text--revealed')).toBe(true);
  });

  it('renders text before and after spoiler correctly', () => {
    const el = createElement('before ||hidden|| after');
    const textEl = getTextEl(el);
    expect(textEl.textContent).toContain('before ');
    expect(textEl.textContent).toContain(' after');
    expect(textEl.querySelector('.spoiler-text')).not.toBeNull();
  });

  it('renders multiple spoilers in one message', () => {
    const el = createElement('||one|| and ||two||');
    const textEl = getTextEl(el);
    const spoilers = textEl.querySelectorAll('.spoiler-text');
    expect(spoilers.length).toBe(2);
  });

  it('spoiler span has aria-label for accessibility', () => {
    const el = createElement('||secret||');
    const span = getTextEl(el).querySelector('.spoiler-text') as HTMLElement;
    expect(span.getAttribute('aria-label')).toBeTruthy();
  });

  it('unmatched || is rendered as literal text', () => {
    const el = createElement('price is ||5');
    const textEl = getTextEl(el);
    expect(textEl.querySelector('.spoiler-text')).toBeNull();
    expect(textEl.textContent).toContain('||5');
  });
});

describe('createBasicMessageElement — spoiler image attachment', () => {
  function createSpoilerAttachmentEl(): HTMLElement {
    const spoilerAttachment: AttachmentData = {
      id: 'att-1',
      name: 'secret.jpg',
      size: 1024,
      mime: 'image/jpeg',
      spoiler: true,
    };
    const getEmberKey = jest.fn().mockResolvedValue(null);
    return window.createBasicMessageElement(
      'Alice',
      '',
      undefined,
      'msg-spoiler-img',
      undefined,
      false,
      spoilerAttachment,
      undefined,
      'channel-1',
      getEmberKey
    );
  }

  it('renders a .spoiler-image-overlay when attachment.spoiler is true', () => {
    const el = createSpoilerAttachmentEl();
    expect(el.querySelector('.spoiler-image-overlay')).not.toBeNull();
  });

  it('spoiler overlay is visible before clicking (no --revealed class)', () => {
    const el = createSpoilerAttachmentEl();
    const overlay = el.querySelector('.spoiler-image-overlay') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains('spoiler-image-overlay--revealed')).toBe(false);
  });

  it('clicking spoiler overlay adds --revealed class and removes spoiler-image-overlay', () => {
    const el = createSpoilerAttachmentEl();
    const overlay = el.querySelector('.spoiler-image-overlay') as HTMLElement;
    overlay.click();
    // The wrapper transitions: spoiler-image-overlay removed, --revealed added
    expect(overlay.classList.contains('spoiler-image-overlay')).toBe(false);
    expect(overlay.classList.contains('spoiler-image-overlay--revealed')).toBe(true);
  });

  it('non-spoiler image attachment does not have .spoiler-image-overlay', () => {
    const normalAttachment: AttachmentData = {
      id: 'att-2',
      name: 'normal.jpg',
      size: 1024,
      mime: 'image/jpeg',
    };
    const el = window.createBasicMessageElement(
      'Alice',
      '',
      undefined,
      'msg-normal-img',
      undefined,
      false,
      normalAttachment,
      undefined,
      'channel-1',
      jest.fn().mockResolvedValue(null)
    );
    expect(el.querySelector('.spoiler-image-overlay')).toBeNull();
  });
});

describe('spoiler persistence — localStorage', () => {
  const STORAGE_KEY = 'ember:spoiler-revealed';

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('clicking a text spoiler saves the message ID to localStorage', () => {
    const el = window.createBasicMessageElement('Alice', '||secret||', undefined, 'persist-msg-1');
    const span = el.querySelector('.spoiler-text') as HTMLElement;
    span.click();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    expect(stored).toContain('persist-msg-1');
  });

  it('clicking an image spoiler saves the message ID to localStorage', () => {
    const attachment: AttachmentData = {
      id: 'a1',
      name: 'img.jpg',
      size: 100,
      mime: 'image/jpeg',
      spoiler: true,
    };
    const el = window.createBasicMessageElement(
      'Alice',
      '',
      undefined,
      'persist-img-1',
      undefined,
      false,
      attachment,
      undefined,
      'ch-1',
      jest.fn().mockResolvedValue(null)
    );
    const overlay = el.querySelector('.spoiler-image-overlay') as HTMLElement;
    overlay.click();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    expect(stored).toContain('persist-img-1');
  });

  it('text spoiler is auto-revealed when message ID is already in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['already-revealed']));
    const el = window.createBasicMessageElement(
      'Alice',
      '||secret||',
      undefined,
      'already-revealed'
    );
    const span = el.querySelector('.spoiler-text') as HTMLElement;
    expect(span.classList.contains('spoiler-text--revealed')).toBe(true);
    expect(span.dataset['revealed']).toBe('true');
  });

  it('image spoiler is auto-revealed when message ID is already in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['img-already-revealed']));
    const attachment: AttachmentData = {
      id: 'a2',
      name: 'img.jpg',
      size: 100,
      mime: 'image/jpeg',
      spoiler: true,
    };
    const el = window.createBasicMessageElement(
      'Alice',
      '',
      undefined,
      'img-already-revealed',
      undefined,
      false,
      attachment,
      undefined,
      'ch-1',
      jest.fn().mockResolvedValue(null)
    );
    // After auto-reveal, the overlay should no longer have spoiler-image-overlay class
    const wrapper = el.querySelector('.image-card-wrapper') as HTMLElement;
    expect(wrapper.classList.contains('spoiler-image-overlay')).toBe(false);
    expect(wrapper.classList.contains('spoiler-image-overlay--revealed')).toBe(true);
  });

  it('unrevealed message does not appear in localStorage', () => {
    window.createBasicMessageElement('Alice', '||secret||', undefined, 'not-yet-revealed');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    expect(stored).not.toContain('not-yet-revealed');
  });
});
