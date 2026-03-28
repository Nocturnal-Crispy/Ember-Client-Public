/**
 * Link Preview Service
 * Fetches Open Graph metadata for URLs via the Electron main process (IPC).
 * Client-side LRU cache with TTL. Request deduplication.
 */
(function (): void {
  const log = window.emberLog.createLogger('LinkPreviewService');

  const STORAGE_KEY = 'ember:link-previews-enabled';
  const MAX_CACHE_SIZE = 200;
  const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  interface CacheEntry {
    data: LinkPreviewData | null;
    timestamp: number;
  }

  const previewCache = new Map<string, CacheEntry>();
  const pendingFetches = new Map<string, Promise<LinkPreviewData | null>>();

  function isLinkPreviewEnabled(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  }

  function getCached(url: string): LinkPreviewData | null | undefined {
    const entry = previewCache.get(url);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      previewCache.delete(url);
      return undefined;
    }
    return entry.data;
  }

  function setCached(url: string, data: LinkPreviewData | null): void {
    if (previewCache.size >= MAX_CACHE_SIZE) {
      const firstKey = previewCache.keys().next().value;
      if (firstKey !== undefined) previewCache.delete(firstKey);
    }
    previewCache.set(url, { data, timestamp: Date.now() });
  }

  async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
    if (!isLinkPreviewEnabled()) return null;
    if (!url.startsWith('https://') && !url.startsWith('http://')) return null;

    const cached = getCached(url);
    if (cached !== undefined) return cached;

    if (pendingFetches.has(url)) return pendingFetches.get(url)!;

    const promise = (async (): Promise<LinkPreviewData | null> => {
      try {
        const data = (await window.electronAPI.ipc.invoke(
          'fetch-link-preview',
          url
        )) as LinkPreviewData | null;
        if (!data || (!data.title && !data.description && !data.imageUrl)) {
          setCached(url, null);
          return null;
        }
        setCached(url, data);
        return data;
      } catch (_err) {
        log.warn('Failed to fetch link preview', { url: url.slice(0, 60) });
        setCached(url, null);
        return null;
      } finally {
        pendingFetches.delete(url);
      }
    })();

    pendingFetches.set(url, promise);
    return promise;
  }

  function setLinkPreviewEnabled(enabled: boolean): void {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    log.info('Link preview setting changed', { enabled });
  }

  window.fetchLinkPreview = fetchLinkPreview;
  window.isLinkPreviewEnabled = isLinkPreviewEnabled;
  window.setLinkPreviewEnabled = setLinkPreviewEnabled;
})();
