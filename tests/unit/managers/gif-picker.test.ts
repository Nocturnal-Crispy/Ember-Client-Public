/**
 * Unit tests for src/renderer/managers/gif-picker.ts
 *
 * Tests cover favorites functionality:
 *   - isGifFavorited: returns false for unfavorited GIF
 *   - addGifFavorite: adds to App.gifFavorites and calls IPC save
 *   - addGifFavorite: no-ops on duplicate URL
 *   - addGifFavorite: new favorite goes to front of list
 *   - removeGifFavorite: removes from App.gifFavorites and calls IPC save
 *   - isGifFavorited: returns true after adding
 *   - getGifFavorites: returns all favorites
 *   - addGifFavorite: enforces MAX_FAVORITES limit of 30
 *
 * @jest-environment jsdom
 */

let mockIpcInvoke: jest.Mock;

function buildPickerDom(): void {
  // Build the GIF picker DOM structure using safe DOM APIs (no innerHTML)
  const panel = document.createElement('div');
  panel.id = 'gif-picker-panel';
  panel.className = 'hidden';

  const searchInput = document.createElement('input');
  searchInput.id = 'gif-picker-search-input';
  searchInput.type = 'text';
  panel.appendChild(searchInput);

  const autocomplete = document.createElement('ul');
  autocomplete.id = 'gif-picker-autocomplete';
  autocomplete.className = 'hidden';
  panel.appendChild(autocomplete);

  const tabs = document.createElement('div');
  tabs.id = 'gif-picker-tabs';

  const tabSearch = document.createElement('button');
  tabSearch.id = 'gif-picker-tab-search';
  tabSearch.className = 'gif-picker-tab gif-picker-tab--active';
  tabSearch.textContent = 'Search';
  tabs.appendChild(tabSearch);

  const tabFavorites = document.createElement('button');
  tabFavorites.id = 'gif-picker-tab-favorites';
  tabFavorites.className = 'gif-picker-tab';
  tabFavorites.textContent = '\u2661 Favorites';
  tabs.appendChild(tabFavorites);

  panel.appendChild(tabs);

  const grid = document.createElement('div');
  grid.id = 'gif-picker-grid';
  const emptyMsg = document.createElement('div');
  emptyMsg.id = 'gif-picker-empty';
  grid.appendChild(emptyMsg);
  panel.appendChild(grid);

  const favGrid = document.createElement('div');
  favGrid.id = 'gif-picker-favorites-grid';
  favGrid.className = 'hidden';
  const favEmpty = document.createElement('div');
  favEmpty.id = 'gif-picker-favorites-empty';
  favGrid.appendChild(favEmpty);
  panel.appendChild(favGrid);

  document.body.appendChild(panel);
}

beforeAll(() => {
  // 1. Set up global DOM that gif-picker init() expects
  buildPickerDom();

  // 2. Populate window.App via app-state module
  require('../../../src/renderer/managers/app-state');

  // 3. Mock window.electronAPI
  mockIpcInvoke = jest.fn().mockImplementation((channel: string) => {
    if (channel === 'get-klipy-api-key') return Promise.resolve('test-key');
    if (channel === 'get-gif-favorites') return Promise.resolve([]);
    if (channel === 'save-gif-favorites') return Promise.resolve(true);
    return Promise.resolve(null);
  });
  (window as any).electronAPI = {
    ipc: {
      invoke: mockIpcInvoke,
      send: jest.fn(),
      on: jest.fn(),
    },
  };

  // 4. Mock window.emberLog
  (window as any).emberLog = {
    createLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  };

  // 5. Stub window.sendGif used by selectGif
  (window as any).sendGif = jest.fn();

  // 6. Load the module (IIFE executes immediately, calls init())
  require('../../../src/renderer/managers/gif-picker');
});

beforeEach(() => {
  // Reset favorites and mock state before each test
  (window as any).App.gifFavorites = [];
  mockIpcInvoke.mockClear();
});

describe('GIF Favorites — query functions', () => {
  it('isGifFavorited returns false when no favorites exist', () => {
    expect((window as any).isGifFavorited('https://example.com/test.gif')).toBe(false);
  });

  it('getGifFavorites returns empty array when no favorites', () => {
    const favs = (window as any).getGifFavorites();
    expect(Array.isArray(favs)).toBe(true);
    expect(favs).toHaveLength(0);
  });

  it('getGifFavorites returns all stored favorites', () => {
    (window as any).App.gifFavorites = [
      { url: 'https://a.com/1.gif', title: 'A', thumbnailUrl: 'https://a.com/1.gif', addedAt: 1 },
      { url: 'https://a.com/2.gif', title: 'B', thumbnailUrl: 'https://a.com/2.gif', addedAt: 2 },
    ];
    const favs = (window as any).getGifFavorites();
    expect(favs).toHaveLength(2);
  });
});

describe('GIF Favorites — addGifFavorite', () => {
  it('adds a GIF to App.gifFavorites', () => {
    const fav = {
      url: 'https://example.com/gif1.gif',
      title: 'Test',
      thumbnailUrl: 'https://example.com/t.gif',
      addedAt: 1000,
    };
    (window as any).addGifFavorite(fav);
    expect((window as any).App.gifFavorites).toHaveLength(1);
    expect((window as any).App.gifFavorites[0].url).toBe(fav.url);
  });

  it('persists to IPC storage on add', () => {
    const fav = {
      url: 'https://example.com/gif2.gif',
      title: 'Test',
      thumbnailUrl: 'https://example.com/t.gif',
      addedAt: 1000,
    };
    (window as any).addGifFavorite(fav);
    expect(mockIpcInvoke).toHaveBeenCalledWith('save-gif-favorites', expect.any(Array));
  });

  it('new favorite is prepended to the list', () => {
    const first = {
      url: 'https://example.com/first.gif',
      title: 'First',
      thumbnailUrl: 'https://example.com/f.gif',
      addedAt: 1,
    };
    const second = {
      url: 'https://example.com/second.gif',
      title: 'Second',
      thumbnailUrl: 'https://example.com/s.gif',
      addedAt: 2,
    };
    (window as any).addGifFavorite(first);
    (window as any).addGifFavorite(second);
    expect((window as any).App.gifFavorites[0].url).toBe(second.url);
    expect((window as any).App.gifFavorites[1].url).toBe(first.url);
  });

  it('does not add duplicate URLs', () => {
    const fav = {
      url: 'https://example.com/dup.gif',
      title: 'Dup',
      thumbnailUrl: 'https://example.com/d.gif',
      addedAt: 1,
    };
    (window as any).addGifFavorite(fav);
    (window as any).addGifFavorite({ ...fav, addedAt: 999 });
    expect((window as any).App.gifFavorites).toHaveLength(1);
  });

  it('enforces MAX_FAVORITES limit of 30', () => {
    const existing = Array.from({ length: 30 }, (_, i) => ({
      url: `https://example.com/${i}.gif`,
      title: `GIF ${i}`,
      thumbnailUrl: `https://example.com/${i}.gif`,
      addedAt: i,
    }));
    (window as any).App.gifFavorites = existing;

    (window as any).addGifFavorite({
      url: 'https://example.com/overflow.gif',
      title: 'Overflow',
      thumbnailUrl: 'https://example.com/o.gif',
      addedAt: 999,
    });

    expect((window as any).App.gifFavorites).toHaveLength(30);
  });

  it('isGifFavorited returns true after adding', () => {
    const fav = {
      url: 'https://example.com/check.gif',
      title: 'Check',
      thumbnailUrl: 'https://example.com/c.gif',
      addedAt: 1,
    };
    (window as any).addGifFavorite(fav);
    expect((window as any).isGifFavorited('https://example.com/check.gif')).toBe(true);
  });
});

describe('GIF Favorites — removeGifFavorite', () => {
  it('removes a GIF from App.gifFavorites by URL', () => {
    (window as any).App.gifFavorites = [
      {
        url: 'https://example.com/remove.gif',
        title: 'Remove',
        thumbnailUrl: 'https://example.com/r.gif',
        addedAt: 1,
      },
    ];
    (window as any).removeGifFavorite('https://example.com/remove.gif');
    expect((window as any).App.gifFavorites).toHaveLength(0);
  });

  it('persists to IPC storage on remove', () => {
    (window as any).App.gifFavorites = [
      {
        url: 'https://example.com/store.gif',
        title: 'Store',
        thumbnailUrl: 'https://example.com/s.gif',
        addedAt: 1,
      },
    ];
    (window as any).removeGifFavorite('https://example.com/store.gif');
    expect(mockIpcInvoke).toHaveBeenCalledWith('save-gif-favorites', expect.any(Array));
  });

  it('isGifFavorited returns false after removing', () => {
    (window as any).App.gifFavorites = [
      {
        url: 'https://example.com/gone.gif',
        title: 'Gone',
        thumbnailUrl: 'https://example.com/g.gif',
        addedAt: 1,
      },
    ];
    (window as any).removeGifFavorite('https://example.com/gone.gif');
    expect((window as any).isGifFavorited('https://example.com/gone.gif')).toBe(false);
  });

  it('no-ops when URL is not in favorites', () => {
    (window as any).App.gifFavorites = [
      {
        url: 'https://example.com/keep.gif',
        title: 'Keep',
        thumbnailUrl: 'https://example.com/k.gif',
        addedAt: 1,
      },
    ];
    (window as any).removeGifFavorite('https://example.com/nonexistent.gif');
    expect((window as any).App.gifFavorites).toHaveLength(1);
  });
});
