/**
 * Unit tests for src/renderer/components/format-toolbar.ts
 *
 * Tests the floating markdown formatting toolbar:
 *   - Toolbar is hidden by default
 *   - Shows on mouseup with selection in a .message-input textarea
 *   - Hides when clicking outside
 *   - Each button wraps selected text with correct markdown syntax
 *   - Toggle: clicking a button on already-wrapped text unwraps it
 *   - Blockquote prefixes each line
 *   - Keyboard selection shows toolbar above textarea
 */

// @jest-environment jsdom

function makeTextarea(): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  ta.className = 'message-input';
  ta.id = 'messageInput';
  document.body.appendChild(ta);
  return ta;
}

function fireMouseup(target: HTMLElement, clientX = 100, clientY = 200): void {
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX, clientY }));
}

function fireKeyup(target: HTMLElement, key = 'ArrowRight'): void {
  target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key }));
}

beforeAll(() => {
  // Mock window.App and electronAPI (required by app-state)
  (window as any).App = {
    activeChannelId: null,
    activeEmberId: null,
    emberKeyCache: new Map(),
    ownedMessageIds: new Set(),
    currentEmbers: [],
    currentMembers: [],
    pendingAttachment: null,
    gifFavorites: [],
  };
  (window as any).electronAPI = {
    ipc: { invoke: jest.fn(), send: jest.fn(), on: jest.fn() },
    crypto: {},
    nacl: {},
    naclUtil: {},
  };
  (window as any).emberLog = {
    createLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  };

  require('../../../src/renderer/components/format-toolbar');
});

afterEach(() => {
  // Remove any textareas added during the test
  document.querySelectorAll('textarea.message-input').forEach(el => el.remove());
});

function getToolbar(): HTMLElement {
  return document.getElementById('format-toolbar') as HTMLElement;
}

describe('format-toolbar — visibility', () => {
  it('toolbar element exists in the DOM after module load', () => {
    expect(getToolbar()).not.toBeNull();
  });

  it('toolbar is hidden by default', () => {
    const tb = getToolbar();
    expect(tb.classList.contains('format-toolbar--hidden')).toBe(true);
  });

  it('shows when mouseup fires on .message-input with a selection', () => {
    const ta = makeTextarea();
    ta.value = 'hello world';
    ta.setSelectionRange(0, 5);
    fireMouseup(ta);
    expect(getToolbar().classList.contains('format-toolbar--hidden')).toBe(false);
  });

  it('stays hidden when mouseup fires with no selection', () => {
    const ta = makeTextarea();
    ta.value = 'hello world';
    ta.setSelectionRange(3, 3); // collapsed
    fireMouseup(ta);
    expect(getToolbar().classList.contains('format-toolbar--hidden')).toBe(true);
  });

  it('stays hidden when mouseup fires on a non-.message-input element', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    fireMouseup(div);
    expect(getToolbar().classList.contains('format-toolbar--hidden')).toBe(true);
    div.remove();
  });

  it('hides when mousedown fires outside the toolbar', () => {
    const ta = makeTextarea();
    ta.value = 'hello world';
    ta.setSelectionRange(0, 5);
    fireMouseup(ta); // show it
    expect(getToolbar().classList.contains('format-toolbar--hidden')).toBe(false);

    // Click somewhere outside
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(getToolbar().classList.contains('format-toolbar--hidden')).toBe(true);
  });

  it('hides on Escape key', () => {
    const ta = makeTextarea();
    ta.value = 'hello world';
    ta.setSelectionRange(0, 5);
    fireMouseup(ta);
    expect(getToolbar().classList.contains('format-toolbar--hidden')).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(getToolbar().classList.contains('format-toolbar--hidden')).toBe(true);
  });

  it('shows on keyup when textarea has a selection', () => {
    const ta = makeTextarea();
    ta.value = 'hello world';
    ta.setSelectionRange(0, 5);
    fireKeyup(ta, 'ArrowRight');
    expect(getToolbar().classList.contains('format-toolbar--hidden')).toBe(false);
  });
});

describe('format-toolbar — buttons present', () => {
  it('has a Bold button', () => {
    expect(getToolbar().querySelector('[data-format="bold"]')).not.toBeNull();
  });

  it('has an Italic button', () => {
    expect(getToolbar().querySelector('[data-format="italic"]')).not.toBeNull();
  });

  it('has a Strikethrough button', () => {
    expect(getToolbar().querySelector('[data-format="strikethrough"]')).not.toBeNull();
  });

  it('has a Blockquote button', () => {
    expect(getToolbar().querySelector('[data-format="blockquote"]')).not.toBeNull();
  });

  it('has a Code button', () => {
    expect(getToolbar().querySelector('[data-format="code"]')).not.toBeNull();
  });

  it('has a Spoiler button', () => {
    expect(getToolbar().querySelector('[data-format="spoiler"]')).not.toBeNull();
  });
});

describe('format-toolbar — formatting actions', () => {
  function applyViaButton(title: string, value: string, selStart: number, selEnd: number): string {
    const ta = makeTextarea();
    ta.value = value;
    ta.setSelectionRange(selStart, selEnd);
    fireMouseup(ta); // show toolbar

    const btn = getToolbar().querySelector(`[data-format="${title.toLowerCase()}"]`) as HTMLElement;
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    ta.remove();
    return ta.value;
  }

  it('Bold wraps selection with **', () => {
    expect(applyViaButton('bold', 'hello world', 0, 5)).toBe('**hello** world');
  });

  it('Italic wraps selection with *', () => {
    expect(applyViaButton('italic', 'hello world', 0, 5)).toBe('*hello* world');
  });

  it('Strikethrough wraps selection with ~~', () => {
    expect(applyViaButton('strikethrough', 'hello world', 0, 5)).toBe('~~hello~~ world');
  });

  it('Code wraps selection with backticks', () => {
    expect(applyViaButton('code', 'hello world', 0, 5)).toBe('`hello` world');
  });

  it('Spoiler wraps selection with ||', () => {
    expect(applyViaButton('spoiler', 'hello world', 0, 5)).toBe('||hello|| world');
  });

  it("Blockquote prefixes the selected line with '> '", () => {
    expect(applyViaButton('blockquote', 'hello world', 0, 5)).toBe('> hello world');
  });

  it('Blockquote prefixes every line when selection spans multiple lines', () => {
    const result = applyViaButton('blockquote', 'line1\nline2\nline3', 0, 17);
    expect(result).toBe('> line1\n> line2\n> line3');
  });

  it('Bold toggles off when selection is already bold', () => {
    expect(applyViaButton('bold', '**hello** world', 0, 9)).toBe('hello world');
  });

  it('Spoiler toggles off when selection is already a spoiler', () => {
    expect(applyViaButton('spoiler', '||secret|| text', 0, 10)).toBe('secret text');
  });
});
