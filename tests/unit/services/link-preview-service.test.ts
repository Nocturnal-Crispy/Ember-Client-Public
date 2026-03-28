// @jest-environment jsdom

let mockInvoke: jest.Mock;

beforeAll(() => {
  const store: Record<string, string> = {};
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: jest.fn((key: string) => store[key] ?? null),
      setItem: jest.fn((key: string, val: string) => {
        store[key] = val;
      }),
      removeItem: jest.fn((key: string) => {
        delete store[key];
      }),
      clear: jest.fn(() => {
        for (const k in store) delete store[k];
      }),
    },
    writable: true,
  });

  mockInvoke = jest.fn().mockResolvedValue(null);

  (window as any).electronAPI = {
    ipc: { invoke: mockInvoke, send: jest.fn(), on: jest.fn() },
    nacl: {},
    naclUtil: {},
    crypto: {},
  };

  (window as any).emberLog = {
    createLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  };

  require('../../../src/renderer/services/link-preview-service');
});

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(null);
  (window.localStorage.getItem as jest.Mock).mockReturnValue(null);
});

const validPreview = {
  url: 'https://example.com',
  title: 'Example',
  description: 'An example page',
  imageUrl: 'https://example.com/image.png',
  siteName: 'Example Site',
};

describe('LinkPreviewService', () => {
  describe('isLinkPreviewEnabled', () => {
    it('returns true by default when localStorage returns null', () => {
      (window.localStorage.getItem as jest.Mock).mockReturnValue(null);
      expect((window as any).isLinkPreviewEnabled()).toBe(true);
    });

    it('returns false when disabled in localStorage', () => {
      (window.localStorage.getItem as jest.Mock).mockReturnValue('false');
      expect((window as any).isLinkPreviewEnabled()).toBe(false);
    });
  });

  describe('setLinkPreviewEnabled', () => {
    it('saves the setting to localStorage', () => {
      (window as any).setLinkPreviewEnabled(false);
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        'ember:link-previews-enabled',
        'false'
      );
    });
  });

  describe('fetchLinkPreview', () => {
    it('accepts HTTP URLs and calls IPC', async () => {
      mockInvoke.mockResolvedValue(validPreview);
      const result = await (window as any).fetchLinkPreview('http://example.com');
      expect(mockInvoke).toHaveBeenCalledWith('fetch-link-preview', 'http://example.com');
      expect(result).toEqual(validPreview);
    });

    it('accepts HTTPS URLs and calls IPC', async () => {
      mockInvoke.mockResolvedValue(validPreview);
      const result = await (window as any).fetchLinkPreview('https://example.com/page');
      expect(mockInvoke).toHaveBeenCalledWith('fetch-link-preview', 'https://example.com/page');
      expect(result).toEqual(validPreview);
    });

    it('rejects non-URL strings and returns null', async () => {
      const result = await (window as any).fetchLinkPreview('not a url');
      expect(result).toBeNull();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('returns null when link previews are disabled', async () => {
      (window.localStorage.getItem as jest.Mock).mockReturnValue('false');
      const result = await (window as any).fetchLinkPreview('https://example.com');
      expect(result).toBeNull();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('returns null when IPC returns null', async () => {
      mockInvoke.mockResolvedValue(null);
      const result = await (window as any).fetchLinkPreview('https://null-response.com');
      expect(result).toBeNull();
    });

    it('returns null on empty data (no title, description, imageUrl)', async () => {
      mockInvoke.mockResolvedValue({ url: 'https://empty.com' });
      const result = await (window as any).fetchLinkPreview('https://empty.com');
      expect(result).toBeNull();
    });

    it('returns null on IPC error', async () => {
      mockInvoke.mockRejectedValue(new Error('IPC failed'));
      const result = await (window as any).fetchLinkPreview('https://error.com');
      expect(result).toBeNull();
    });

    it('caches results and does not call IPC again for the same URL', async () => {
      mockInvoke.mockResolvedValue(validPreview);
      const url = 'https://cached-test.com';
      const first = await (window as any).fetchLinkPreview(url);
      const second = await (window as any).fetchLinkPreview(url);
      expect(first).toEqual(validPreview);
      expect(second).toEqual(validPreview);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent requests for the same URL', async () => {
      mockInvoke.mockResolvedValue(validPreview);
      const url = 'https://dedup-test.com';
      const [r1, r2] = await Promise.all([
        (window as any).fetchLinkPreview(url),
        (window as any).fetchLinkPreview(url),
      ]);
      expect(r1).toEqual(validPreview);
      expect(r2).toEqual(validPreview);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });
});
