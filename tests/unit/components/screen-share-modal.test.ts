/**
 * Unit tests for src/renderer/components/screen-share-modal.ts
 *
 * Tests modal show/hide, source grid rendering, audio availability gating,
 * settings controls (resolution / frame rate / audio checkbox), source
 * selection callback, and keyboard / backdrop close interactions.
 */

// @jest-environment jsdom

import type {} from '../../../src/renderer/types/globals';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const SCREEN_SOURCE: ScreenSource = {
  id: 'screen:0',
  name: 'Entire Screen',
  thumbnailDataUrl: 'data:image/png;base64,abc',
  type: 'screen',
};

const WINDOW_SOURCE: ScreenSource = {
  id: 'window:1001',
  name: 'Firefox',
  thumbnailDataUrl: 'data:image/png;base64,def',
  type: 'window',
};

// ─── DOM builder (mirrors the HTML fragment the main-loader injects) ──────────

function buildModalDom(): void {
  const modal = document.createElement('div');
  modal.id = 'screen-share-modal';
  modal.className = 'modal-overlay hidden';

  const container = document.createElement('div');
  container.id = 'screen-share-container';
  container.className = 'screen-share-container';

  const closeBtn = document.createElement('button');
  closeBtn.id = 'screen-share-close';
  closeBtn.textContent = '✕';

  const title = document.createElement('h2');
  title.id = 'screen-share-title';
  title.textContent = 'Share your screen';

  const grid = document.createElement('div');
  grid.id = 'screen-share-source-grid';
  grid.className = 'screen-share-source-grid';

  const settings = document.createElement('div');
  settings.className = 'screen-share-settings';

  const resolutionSelect = document.createElement('select');
  resolutionSelect.id = 'screen-share-resolution';
  for (const v of ['720p', '1080p', '1440p']) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    resolutionSelect.appendChild(opt);
  }

  const framerateSelect = document.createElement('select');
  framerateSelect.id = 'screen-share-framerate';
  for (const v of ['15', '30', '60']) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = `${v} fps`;
    framerateSelect.appendChild(opt);
  }

  const audioLabel = document.createElement('label');
  audioLabel.id = 'screen-share-audio-label';
  audioLabel.htmlFor = 'screen-share-audio-checkbox';

  const audioCheckbox = document.createElement('input');
  audioCheckbox.type = 'checkbox';
  audioCheckbox.id = 'screen-share-audio-checkbox';

  const audioStatus = document.createElement('span');
  audioStatus.id = 'screen-share-audio-status';

  audioLabel.appendChild(audioCheckbox);
  audioLabel.appendChild(audioStatus);

  const confirmBtn = document.createElement('button');
  confirmBtn.id = 'screen-share-confirm';
  confirmBtn.textContent = 'Share';
  confirmBtn.disabled = true;

  settings.appendChild(resolutionSelect);
  settings.appendChild(framerateSelect);
  settings.appendChild(audioLabel);

  container.appendChild(closeBtn);
  container.appendChild(title);
  container.appendChild(grid);
  container.appendChild(settings);
  container.appendChild(confirmBtn);
  modal.appendChild(container);
  document.body.appendChild(modal);
}

// ─── Test setup ───────────────────────────────────────────────────────────────

let mockOnSelect: jest.Mock;

beforeAll(() => {
  // 1. Load app-state
  require('../../../src/renderer/managers/app-state');

  // 2. Mock window.electronAPI
  (window as any).electronAPI = {
    ipc: {
      invoke: jest.fn().mockResolvedValue(null),
      send: jest.fn(),
      on: jest.fn(),
    },
    nacl: {},
    naclUtil: {},
    crypto: {},
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

  // 4. Build DOM fragment
  buildModalDom();

  // 5. Load the IIFE module
  require('../../../src/renderer/components/screen-share-modal');
});

beforeEach(() => {
  mockOnSelect = jest.fn();

  // Reset modal to hidden state
  const modal = document.getElementById('screen-share-modal')!;
  modal.classList.add('hidden');

  // Clear source grid
  const grid = document.getElementById('screen-share-source-grid')!;
  grid.replaceChildren();

  // Reset settings to defaults
  (document.getElementById('screen-share-resolution') as HTMLSelectElement).value = '720p';
  (document.getElementById('screen-share-framerate') as HTMLSelectElement).value = '15';
  const cb = document.getElementById('screen-share-audio-checkbox') as HTMLInputElement;
  cb.checked = false;
  cb.disabled = false;
  document.getElementById('screen-share-audio-status')!.textContent = '';

  // Reset confirm button
  const confirm = document.getElementById('screen-share-confirm') as HTMLButtonElement;
  confirm.disabled = true;
});

// ─── openScreenShareModal ─────────────────────────────────────────────────────

describe('openScreenShareModal', () => {
  it('removes the hidden class from the modal', () => {
    window.openScreenShareModal([SCREEN_SOURCE], true, mockOnSelect);

    const modal = document.getElementById('screen-share-modal')!;
    expect(modal.classList.contains('hidden')).toBe(false);
  });

  it('renders one card per source in the grid', () => {
    window.openScreenShareModal([SCREEN_SOURCE, WINDOW_SOURCE], true, mockOnSelect);

    const grid = document.getElementById('screen-share-source-grid')!;
    expect(grid.children.length).toBe(2);
  });

  it('renders source names as text in each card', () => {
    window.openScreenShareModal([SCREEN_SOURCE, WINDOW_SOURCE], true, mockOnSelect);

    const grid = document.getElementById('screen-share-source-grid')!;
    const names = Array.from(grid.querySelectorAll('[data-source-name]')).map(
      (el) => el.textContent
    );
    expect(names).toContain('Entire Screen');
    expect(names).toContain('Firefox');
  });

  it('renders thumbnail images with the provided dataUrl', () => {
    window.openScreenShareModal([SCREEN_SOURCE], true, mockOnSelect);

    const img = document.querySelector('#screen-share-source-grid img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe(SCREEN_SOURCE.thumbnailDataUrl);
  });

  it('confirms button remains disabled until a source is selected', () => {
    window.openScreenShareModal([SCREEN_SOURCE], true, mockOnSelect);

    const btn = document.getElementById('screen-share-confirm') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('enables the confirm button after clicking a source card', () => {
    window.openScreenShareModal([SCREEN_SOURCE], true, mockOnSelect);

    const card = document.querySelector('#screen-share-source-grid [data-source-id]') as HTMLElement;
    card.click();

    const btn = document.getElementById('screen-share-confirm') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('marks the clicked source card as selected', () => {
    window.openScreenShareModal([SCREEN_SOURCE, WINDOW_SOURCE], true, mockOnSelect);

    const cards = document.querySelectorAll('#screen-share-source-grid [data-source-id]');
    (cards[1] as HTMLElement).click();

    expect((cards[1] as HTMLElement).classList.contains('selected')).toBe(true);
    expect((cards[0] as HTMLElement).classList.contains('selected')).toBe(false);
  });

  it('replaces previous source grid contents when called again', () => {
    window.openScreenShareModal([SCREEN_SOURCE], true, mockOnSelect);
    window.openScreenShareModal([WINDOW_SOURCE], true, mockOnSelect);

    const grid = document.getElementById('screen-share-source-grid')!;
    expect(grid.children.length).toBe(1);
    const name = grid.querySelector('[data-source-name]')!.textContent;
    expect(name).toBe('Firefox');
  });
});

// ─── audioAvailable = false ───────────────────────────────────────────────────

describe('openScreenShareModal — audioAvailable: false', () => {
  beforeEach(() => {
    window.openScreenShareModal([SCREEN_SOURCE], false, mockOnSelect);
  });

  it('disables the audio checkbox', () => {
    const cb = document.getElementById('screen-share-audio-checkbox') as HTMLInputElement;
    expect(cb.disabled).toBe(true);
  });

  it('unchecks the audio checkbox', () => {
    const cb = document.getElementById('screen-share-audio-checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it('shows "not available" text in the audio status element', () => {
    const status = document.getElementById('screen-share-audio-status')!;
    expect(status.textContent?.toLowerCase()).toContain('not available');
  });

  it('invokes onSelect callback with includeAudio: false when confirmed', () => {
    const card = document.querySelector('#screen-share-source-grid [data-source-id]') as HTMLElement;
    card.click();
    document.getElementById('screen-share-confirm')!.click();

    expect(mockOnSelect).toHaveBeenCalledWith(
      SCREEN_SOURCE,
      expect.objectContaining({ includeAudio: false })
    );
  });
});

// ─── audioAvailable = true ────────────────────────────────────────────────────

describe('openScreenShareModal — audioAvailable: true', () => {
  beforeEach(() => {
    window.openScreenShareModal([SCREEN_SOURCE], true, mockOnSelect);
  });

  it('enables the audio checkbox', () => {
    const cb = document.getElementById('screen-share-audio-checkbox') as HTMLInputElement;
    expect(cb.disabled).toBe(false);
  });

  it('shows a status label (non-empty) when audio is available', () => {
    const status = document.getElementById('screen-share-audio-status')!;
    // Should display some platform context — just verify it is not empty
    expect((status.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('passes includeAudio: true when checkbox is checked before confirm', () => {
    const cb = document.getElementById('screen-share-audio-checkbox') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));

    const card = document.querySelector('#screen-share-source-grid [data-source-id]') as HTMLElement;
    card.click();
    document.getElementById('screen-share-confirm')!.click();

    expect(mockOnSelect).toHaveBeenCalledWith(
      SCREEN_SOURCE,
      expect.objectContaining({ includeAudio: true })
    );
  });

  it('passes includeAudio: false when checkbox is unchecked', () => {
    const cb = document.getElementById('screen-share-audio-checkbox') as HTMLInputElement;
    cb.checked = false;

    const card = document.querySelector('#screen-share-source-grid [data-source-id]') as HTMLElement;
    card.click();
    document.getElementById('screen-share-confirm')!.click();

    expect(mockOnSelect).toHaveBeenCalledWith(
      SCREEN_SOURCE,
      expect.objectContaining({ includeAudio: false })
    );
  });
});

// ─── Phase 9: audioLabel parameter ───────────────────────────────────────────

describe('openScreenShareModal — audioLabel parameter', () => {
  it('displays the specific audioLabel text in the status element when provided', () => {
    const platformLabel = 'WASAPI process loopback (Windows 10 2004+)';
    (window.openScreenShareModal as Function)([SCREEN_SOURCE], true, mockOnSelect, platformLabel);

    const status = document.getElementById('screen-share-audio-status')!;
    expect(status.textContent).toContain(platformLabel);
  });

  it('shows generic text when audioLabel is not provided (backward compat)', () => {
    window.openScreenShareModal([SCREEN_SOURCE], true, mockOnSelect);

    const status = document.getElementById('screen-share-audio-status')!;
    expect((status.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('shows PipeWire label when provided', () => {
    const platformLabel = 'PipeWire node-based capture';
    (window.openScreenShareModal as Function)([SCREEN_SOURCE], true, mockOnSelect, platformLabel);

    const status = document.getElementById('screen-share-audio-status')!;
    expect(status.textContent).toContain('PipeWire');
  });
});

// ─── Settings — resolution and frame rate ─────────────────────────────────────

describe('openScreenShareModal — settings', () => {
  beforeEach(() => {
    window.openScreenShareModal([SCREEN_SOURCE], true, mockOnSelect);
  });

  it('defaults to 720p resolution', () => {
    const sel = document.getElementById('screen-share-resolution') as HTMLSelectElement;
    expect(sel.value).toBe('720p');
  });

  it('defaults to 15 fps', () => {
    const sel = document.getElementById('screen-share-framerate') as HTMLSelectElement;
    expect(sel.value).toBe('15');
  });

  it('passes the selected resolution to onSelect', () => {
    const sel = document.getElementById('screen-share-resolution') as HTMLSelectElement;
    sel.value = '1080p';
    sel.dispatchEvent(new Event('change'));

    const card = document.querySelector('#screen-share-source-grid [data-source-id]') as HTMLElement;
    card.click();
    document.getElementById('screen-share-confirm')!.click();

    expect(mockOnSelect).toHaveBeenCalledWith(
      SCREEN_SOURCE,
      expect.objectContaining({ resolution: '1080p' })
    );
  });

  it('passes the selected frame rate to onSelect', () => {
    const sel = document.getElementById('screen-share-framerate') as HTMLSelectElement;
    sel.value = '30';
    sel.dispatchEvent(new Event('change'));

    const card = document.querySelector('#screen-share-source-grid [data-source-id]') as HTMLElement;
    card.click();
    document.getElementById('screen-share-confirm')!.click();

    expect(mockOnSelect).toHaveBeenCalledWith(
      SCREEN_SOURCE,
      expect.objectContaining({ frameRate: 30 })
    );
  });
});

// ─── onSelect callback ────────────────────────────────────────────────────────

describe('onSelect callback', () => {
  it('calls onSelect with the selected source and current settings on confirm', () => {
    window.openScreenShareModal([SCREEN_SOURCE, WINDOW_SOURCE], true, mockOnSelect);

    // Select second source
    const cards = document.querySelectorAll('#screen-share-source-grid [data-source-id]');
    (cards[1] as HTMLElement).click();

    // Confirm
    document.getElementById('screen-share-confirm')!.click();

    expect(mockOnSelect).toHaveBeenCalledTimes(1);
    expect(mockOnSelect).toHaveBeenCalledWith(
      WINDOW_SOURCE,
      expect.objectContaining({
        sourceId: WINDOW_SOURCE.id,
        includeAudio: false,
        resolution: '720p',
        frameRate: 15,
      })
    );
  });

  it('hides the modal after onSelect is invoked', () => {
    window.openScreenShareModal([SCREEN_SOURCE], true, mockOnSelect);

    const card = document.querySelector('#screen-share-source-grid [data-source-id]') as HTMLElement;
    card.click();
    document.getElementById('screen-share-confirm')!.click();

    const modal = document.getElementById('screen-share-modal')!;
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('does not call onSelect when confirm is clicked with no source selected', () => {
    window.openScreenShareModal([SCREEN_SOURCE], true, mockOnSelect);

    // Confirm without selecting a source (button should be disabled — but verify callback not fired)
    const btn = document.getElementById('screen-share-confirm') as HTMLButtonElement;
    // Simulate direct click even though button is disabled to ensure guard is in place
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(mockOnSelect).not.toHaveBeenCalled();
  });
});

// ─── hideScreenShareModal ─────────────────────────────────────────────────────

describe('hideScreenShareModal', () => {
  it('adds the hidden class to the modal', () => {
    window.openScreenShareModal([SCREEN_SOURCE], true, mockOnSelect);
    window.hideScreenShareModal();

    const modal = document.getElementById('screen-share-modal')!;
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('is safe to call when modal is already hidden', () => {
    expect(() => window.hideScreenShareModal()).not.toThrow();
  });
});

// ─── Close interactions ───────────────────────────────────────────────────────

describe('modal close interactions', () => {
  beforeEach(() => {
    window.openScreenShareModal([SCREEN_SOURCE], true, mockOnSelect);
  });

  it('closes when the close button is clicked', () => {
    document.getElementById('screen-share-close')!.click();

    const modal = document.getElementById('screen-share-modal')!;
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('closes when clicking the modal overlay backdrop directly', () => {
    const modal = document.getElementById('screen-share-modal')!;
    const clickEvent = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(clickEvent, 'target', { value: modal });
    modal.dispatchEvent(clickEvent);

    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('does not close when clicking inside the container', () => {
    const modal = document.getElementById('screen-share-modal')!;
    const container = document.getElementById('screen-share-container')!;
    const clickEvent = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(clickEvent, 'target', { value: container });
    modal.dispatchEvent(clickEvent);

    expect(modal.classList.contains('hidden')).toBe(false);
  });

  it('closes when the ESC key is pressed', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    const modal = document.getElementById('screen-share-modal')!;
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('does not call onSelect when closed via close button', () => {
    document.getElementById('screen-share-close')!.click();
    expect(mockOnSelect).not.toHaveBeenCalled();
  });
});
