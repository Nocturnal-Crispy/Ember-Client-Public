/**
 * GIF Picker — floating GIF search panel powered by Klipy.
 * Exposes window.openGifPicker(triggerEl) to open the picker anchored
 * near triggerEl. Selected GIFs are sent via window.sendGif(url, title).
 *
 * Favorites: users can save GIFs via the heart (♡) button on each item.
 * Favorites persist across sessions via IPC storage (max 30).
 */
(function (): void {
  const log = window.emberLog.createLogger("GifPicker");

  // ── Types ─────────────────────────────────────────────────────────────────

  interface GifFile {
    url: string;
    width?: number;
    height?: number;
  }

  interface GifResultFile {
    webp?: GifFile;
    gif?: GifFile;
  }

  interface GifResult {
    type?: string;
    title?: string;
    file?: {
      hd?: GifResultFile;
    };
    content?: string;
    width?: number;
    height?: number;
  }

  interface KlipyResponse {
    data: {
      data: GifResult[];
    };
  }

  interface AutocompleteResponse {
    data: string[] | { data: string[] };
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  let KLIPY_APP_KEY: string | null = null;
  const KLIPY_BASE_URL = "https://api.klipy.com/api/v1";
  const GIF_PER_PAGE = 20;
  const SEARCH_DEBOUNCE_MS = 400;
  const AUTOCOMPLETE_DEBOUNCE_MS = 150;
  const AUTOCOMPLETE_LIMIT = 8;
  const SUGGESTION_LIMIT = 6;
  const AUTOCOMPLETE_MIN_CHARS = 2;
  const AD_MAX_WIDTH = 344;
  const AD_MAX_HEIGHT = 250;
  const MOBILE_USER_AGENT =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
  const MAX_FAVORITES = 30;

  // ── Session customer ID ───────────────────────────────────────────────────
  // Generated once per session; never written to storage.
  const SESSION_CUSTOMER_ID = crypto.randomUUID();

  // ── State ─────────────────────────────────────────────────────────────────

  let panel: HTMLElement | null = null;
  let searchInput: HTMLInputElement | null = null;
  let gridEl: HTMLElement | null = null;
  let favoritesGridEl: HTMLElement | null = null;
  let autocompleteEl: HTMLElement | null = null;
  let tabSearchBtn: HTMLButtonElement | null = null;
  let tabFavoritesBtn: HTMLButtonElement | null = null;
  let triggerEl: HTMLElement | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let autocompleteTimer: ReturnType<typeof setTimeout> | null = null;
  let outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  let escKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  let currentPage = 1;
  let currentQuery: string | null = null; // null = trending
  let isLoading = false;
  let hasMore = true;
  let activeSuggestionIndex = -1;
  let currentTab: "search" | "favorites" = "search";

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getLocale(): string {
    const lang = navigator.language || "en-US";
    const parts = lang.split("-");
    return (parts[1] || parts[0] || "us").toLowerCase();
  }

  function buildAdParams(): Record<string, string> {
    return {
      "ad-min-width": "50",
      "ad-max-width": String(AD_MAX_WIDTH),
      "ad-min-height": "50",
      "ad-max-height": String(AD_MAX_HEIGHT),
      "ad-pxratio": String(window.devicePixelRatio ?? 1),
      "ad-iframe": "0",
    };
  }

  function toQueryString(params: Record<string, string>): string {
    return Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  }

  function extractStringList(response: AutocompleteResponse): string[] {
    if (Array.isArray(response.data)) return response.data;
    if (response.data && Array.isArray((response.data as { data: string[] }).data)) {
      return (response.data as { data: string[] }).data;
    }
    return [];
  }

  function isAdItem(item: GifResult): boolean {
    return item.type === "ad";
  }

  function isApiKeyConfigured(): boolean {
    return KLIPY_APP_KEY !== null && KLIPY_APP_KEY.length > 0;
  }

  // ── Favorites persistence ─────────────────────────────────────────────────

  async function loadFavoritesFromStorage(): Promise<void> {
    try {
      const result = (await window.electronAPI.ipc.invoke(
        "get-gif-favorites"
      )) as GifFavorite[] | null;
      window.App.gifFavorites = Array.isArray(result) ? result : [];
      log.debug("GIF favorites loaded", { count: window.App.gifFavorites.length });
    } catch (err) {
      log.error("Failed to load GIF favorites", { error: String(err) });
      window.App.gifFavorites = [];
    }
  }

  function saveFavoritesToStorage(favorites: GifFavorite[]): void {
    window.electronAPI.ipc.invoke("save-gif-favorites", favorites).catch((err) => {
      log.error("Failed to save GIF favorites", { error: String(err) });
    });
  }

  // ── Favorites management ──────────────────────────────────────────────────

  function getFavorites(): GifFavorite[] {
    return window.App.gifFavorites ?? [];
  }

  function isFavorited(url: string): boolean {
    return getFavorites().some((f) => f.url === url);
  }

  function addFavorite(favorite: GifFavorite): void {
    if (isFavorited(favorite.url)) return;
    const updated = [favorite, ...getFavorites()].slice(0, MAX_FAVORITES);
    window.App.gifFavorites = updated;
    saveFavoritesToStorage(updated);
    updateHeartButtonsForUrl(favorite.url, true);
    if (currentTab === "favorites") renderFavoritesGrid();
  }

  function removeFavorite(url: string): void {
    const updated = getFavorites().filter((f) => f.url !== url);
    window.App.gifFavorites = updated;
    saveFavoritesToStorage(updated);
    updateHeartButtonsForUrl(url, false);
    if (currentTab === "favorites") renderFavoritesGrid();
  }

  function updateHeartButtonsForUrl(url: string, favorited: boolean): void {
    if (!gridEl) return;
    const items = gridEl.querySelectorAll<HTMLElement>("[data-gif-url]");
    items.forEach((item) => {
      if (item.dataset["gifUrl"] === url) {
        const btn = item.querySelector<HTMLButtonElement>(".gif-picker-heart-btn");
        if (!btn) return;
        btn.classList.toggle("gif-picker-heart-btn--active", favorited);
        btn.title = favorited ? "Remove from favorites" : "Add to favorites";
        btn.textContent = favorited ? "\u2665" : "\u2661";
      }
    });
  }

  // ── Heart button ──────────────────────────────────────────────────────────

  function createHeartButton(
    url: string,
    title: string,
    thumbnailUrl: string
  ): HTMLButtonElement {
    const favorited = isFavorited(url);
    const btn = document.createElement("button");
    btn.className =
      "gif-picker-heart-btn" +
      (favorited ? " gif-picker-heart-btn--active" : "");
    btn.title = favorited ? "Remove from favorites" : "Add to favorites";
    btn.textContent = favorited ? "\u2665" : "\u2661";
    btn.type = "button";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isFavorited(url)) {
        removeFavorite(url);
      } else {
        addFavorite({ url, title, thumbnailUrl, addedAt: Date.now() });
      }
    });
    return btn;
  }

  // ── Favorites grid rendering ──────────────────────────────────────────────

  function renderFavoritesGrid(): void {
    if (!favoritesGridEl) return;
    favoritesGridEl.replaceChildren();
    const favorites = getFavorites();
    if (favorites.length === 0) {
      const empty = document.createElement("div");
      empty.className = "gif-picker-empty";
      empty.textContent = "No favorites yet. Hover a GIF and click \u2661 to save it.";
      favoritesGridEl.appendChild(empty);
      return;
    }
    favorites.forEach((fav) => {
      const item = renderFavoriteItem(fav);
      if (item) favoritesGridEl!.appendChild(item);
    });
  }

  function renderFavoriteItem(fav: GifFavorite): HTMLElement {
    const item = document.createElement("div");
    item.className = "gif-picker-item";
    item.title = fav.title || "GIF";
    item.dataset["gifUrl"] = fav.url;

    const img = document.createElement("img");
    img.src = fav.thumbnailUrl || fav.url;
    img.alt = fav.title || "GIF";
    img.loading = "lazy";
    item.appendChild(img);

    // Remove button always visible in favorites grid
    const removeBtn = document.createElement("button");
    removeBtn.className = "gif-picker-heart-btn gif-picker-heart-btn--active";
    removeBtn.title = "Remove from favorites";
    removeBtn.textContent = "\u2665";
    removeBtn.type = "button";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeFavorite(fav.url);
    });
    item.appendChild(removeBtn);

    item.addEventListener("click", () => {
      selectGif(fav.url, fav.title || "GIF");
    });
    return item;
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────

  function switchToTab(tab: "search" | "favorites"): void {
    currentTab = tab;
    const isSearch = tab === "search";
    if (gridEl) gridEl.classList.toggle("hidden", !isSearch);
    if (favoritesGridEl) favoritesGridEl.classList.toggle("hidden", isSearch);
    tabSearchBtn?.classList.toggle("gif-picker-tab--active", isSearch);
    tabFavoritesBtn?.classList.toggle("gif-picker-tab--active", !isSearch);
    if (tabSearchBtn) tabSearchBtn.setAttribute("aria-selected", isSearch ? "true" : "false");
    if (tabFavoritesBtn) tabFavoritesBtn.setAttribute("aria-selected", isSearch ? "false" : "true");
    if (!isSearch) renderFavoritesGrid();
  }

  // ── DOM initialisation ─────────────────────────────────────────────────────

  async function init(): Promise<void> {
    panel = document.getElementById("gif-picker-panel");
    searchInput = document.getElementById("gif-picker-search-input") as HTMLInputElement | null;
    gridEl = document.getElementById("gif-picker-grid");
    favoritesGridEl = document.getElementById("gif-picker-favorites-grid");
    autocompleteEl = document.getElementById("gif-picker-autocomplete");
    tabSearchBtn = document.getElementById("gif-picker-tab-search") as HTMLButtonElement | null;
    tabFavoritesBtn = document.getElementById("gif-picker-tab-favorites") as HTMLButtonElement | null;

    if (!panel || !searchInput || !gridEl || !autocompleteEl) {
      log.error("GIF picker elements not found in DOM");
      return;
    }

    try {
      KLIPY_APP_KEY = (await window.electronAPI.ipc.invoke("get-klipy-api-key")) as string | null;
      log.debug("Klipy API key loaded successfully");
    } catch (error) {
      log.error("Failed to load Klipy API key", { error });
    }

    await loadFavoritesFromStorage();

    searchInput.addEventListener("input", handleSearchInput);
    searchInput.addEventListener("keydown", handleSearchKeydown);
    gridEl.addEventListener("scroll", handleGridScroll, { passive: true });

    tabSearchBtn?.addEventListener("click", () => switchToTab("search"));
    tabFavoritesBtn?.addEventListener("click", () => switchToTab("favorites"));

    if (!isApiKeyConfigured()) {
      log.warn("Klipy app key not configured. Register at https://partner.klipy.com/");
    }
    log.debug("GIF picker initialised");
  }

  // ── Search handling ───────────────────────────────────────────────────────

  function handleSearchInput(): void {
    // Typing always switches to search tab
    if (currentTab === "favorites") switchToTab("search");

    const query = searchInput?.value.trim() ?? "";

    if (autocompleteTimer !== null) clearTimeout(autocompleteTimer);
    if (query.length >= AUTOCOMPLETE_MIN_CHARS) {
      autocompleteTimer = setTimeout(() => fetchAutocomplete(query), AUTOCOMPLETE_DEBOUNCE_MS);
    } else {
      hideAutocomplete();
    }

    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (query.length === 0) {
        startTrending();
      } else {
        startSearch(query);
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  function handleSearchKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      const query = searchInput?.value.trim() ?? "";
      if (query.length === 0) {
        startTrending();
      } else {
        startSearch(query);
      }
      hideAutocomplete();
      return;
    }
    if (!autocompleteEl || autocompleteEl.classList.contains("hidden")) return;
    const items = autocompleteEl.querySelectorAll("li");
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, items.length - 1);
      updateActiveItem(items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, -1);
      updateActiveItem(items);
    } else if (e.key === "Escape") {
      hideAutocomplete();
    }
  }

  function updateActiveItem(items: NodeListOf<HTMLLIElement>): void {
    items.forEach((item, i) => {
      item.classList.toggle("active", i === activeSuggestionIndex);
    });
  }

  // ── Autocomplete ──────────────────────────────────────────────────────────

  async function fetchAutocomplete(query: string): Promise<void> {
    if (!isApiKeyConfigured()) return;
    try {
      const url = `${KLIPY_BASE_URL}/${KLIPY_APP_KEY}/autocomplete/${encodeURIComponent(query)}?limit=${AUTOCOMPLETE_LIMIT}`;
      const response = await fetch(url, { headers: { "User-Agent": MOBILE_USER_AGENT } });
      if (!response.ok) return;
      const data = (await response.json()) as AutocompleteResponse;
      renderAutocomplete(extractStringList(data));
    } catch {
      hideAutocomplete();
    }
  }

  function renderAutocomplete(terms: string[]): void {
    if (!autocompleteEl || terms.length === 0) {
      hideAutocomplete();
      return;
    }
    activeSuggestionIndex = -1;
    autocompleteEl.replaceChildren();
    terms.forEach((term) => {
      const li = document.createElement("li");
      li.textContent = term;
      li.dataset["term"] = term;
      li.role = "option";
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectSuggestion(term);
      });
      autocompleteEl!.appendChild(li);
    });
    autocompleteEl.classList.remove("hidden");
  }

  function hideAutocomplete(): void {
    autocompleteEl?.classList.add("hidden");
    activeSuggestionIndex = -1;
  }

  function selectSuggestion(term: string): void {
    if (!searchInput) return;
    searchInput.value = term;
    hideAutocomplete();
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (autocompleteTimer !== null) clearTimeout(autocompleteTimer);
    startSearch(term);
  }

  // ── Search suggestions ────────────────────────────────────────────────────

  async function fetchSearchSuggestions(query: string): Promise<void> {
    if (!isApiKeyConfigured() || !gridEl) return;
    try {
      const url = `${KLIPY_BASE_URL}/${KLIPY_APP_KEY}/search-suggestions/${encodeURIComponent(query)}?limit=${SUGGESTION_LIMIT}`;
      const response = await fetch(url, { headers: { "User-Agent": MOBILE_USER_AGENT } });
      if (!response.ok) return;
      const data = (await response.json()) as AutocompleteResponse;
      const terms = extractStringList(data);
      if (terms.length > 0) renderSuggestionChips(terms);
    } catch {
      // Suggestions are non-critical; fail silently
    }
  }

  function renderSuggestionChips(terms: string[]): void {
    if (!gridEl) return;
    const row = document.createElement("div");
    row.className = "gif-picker-suggestions-row";
    terms.forEach((term) => {
      const chip = document.createElement("button");
      chip.className = "gif-picker-suggestion-chip";
      chip.textContent = term;
      chip.type = "button";
      chip.addEventListener("click", () => selectSuggestion(term));
      row.appendChild(chip);
    });
    gridEl.prepend(row);
  }

  // ── Pagination ────────────────────────────────────────────────────────────

  function startTrending(): void {
    currentPage = 1;
    currentQuery = null;
    hasMore = true;
    loadPage();
  }

  function startSearch(query: string): void {
    currentPage = 1;
    currentQuery = query;
    hasMore = true;
    loadPage();
  }

  function loadNextPage(): void {
    currentPage++;
    loadPage();
  }

  async function loadPage(): Promise<void> {
    if (!isApiKeyConfigured()) {
      showEmptyMessage("GIF search requires a Klipy app key. See docs/GIF_SETUP.md");
      return;
    }
    if (isLoading || !hasMore) return;
    isLoading = true;
    const isFirstPage = currentPage === 1;
    if (isFirstPage) {
      showLoading();
    } else {
      showPageLoading();
    }
    try {
      const customerId = encodeURIComponent(SESSION_CUSTOMER_ID);
      const locale = encodeURIComponent(getLocale());
      const adParams = buildAdParams();
      let url: string;
      if (currentQuery === null) {
        url =
          `${KLIPY_BASE_URL}/${KLIPY_APP_KEY}/gifs/trending` +
          `?page=${currentPage}&per_page=${GIF_PER_PAGE}&customer_id=${customerId}&locale=${locale}` +
          `&${toQueryString(adParams)}`;
      } else {
        url =
          `${KLIPY_BASE_URL}/${KLIPY_APP_KEY}/gifs/search` +
          `?q=${encodeURIComponent(currentQuery)}&page=${currentPage}&per_page=${GIF_PER_PAGE}` +
          `&customer_id=${customerId}&locale=${locale}&content_filter=medium` +
          `&${toQueryString(adParams)}`;
      }
      const response = await fetch(url, { headers: { "User-Agent": MOBILE_USER_AGENT } });
      if (!response.ok) throw new Error(`Klipy API error: ${response.status}`);
      const data = (await response.json()) as KlipyResponse;
      const results = data.data.data;
      const gifCount = results.filter((item) => !isAdItem(item)).length;
      hasMore = gifCount > 0;
      appendResults(results, isFirstPage);
      if (isFirstPage && currentQuery !== null && gifCount > 0) {
        fetchSearchSuggestions(currentQuery);
      }
    } catch (err) {
      log.error("GIF load failed", { error: String(err) });
      if (isFirstPage) showError();
    } finally {
      isLoading = false;
    }
  }

  // ── Render results ────────────────────────────────────────────────────────

  function appendResults(results: GifResult[], replace: boolean): void {
    if (!gridEl) return;
    if (replace) {
      gridEl.replaceChildren();
    } else {
      gridEl.querySelector(".gif-picker-page-loading")?.remove();
    }
    const gifResults = results.filter((item) => !isAdItem(item));
    if (replace && gifResults.length === 0) {
      showEmptyMessage("No GIFs found");
      return;
    }
    results.forEach((result) => {
      if (isAdItem(result)) {
        const adEl = renderAdItem(result);
        if (adEl) gridEl!.appendChild(adEl);
      } else {
        const gifEl = renderGifItem(result);
        if (gifEl) gridEl!.appendChild(gifEl);
      }
    });
  }

  function renderGifItem(result: GifResult): HTMLElement | null {
    const preview = result.file?.hd?.webp ?? result.file?.hd?.gif;
    const full = result.file?.hd?.gif ?? result.file?.hd?.webp;
    if (!preview?.url || !full?.url) return null;

    const item = document.createElement("div");
    item.className = "gif-picker-item";
    item.title = result.title || "GIF";
    item.dataset["gifUrl"] = full.url;

    const img = document.createElement("img");
    img.src = preview.url;
    img.alt = result.title || "GIF";
    img.loading = "lazy";
    item.appendChild(img);

    const heartBtn = createHeartButton(full.url, result.title || "GIF", preview.url);
    item.appendChild(heartBtn);

    item.addEventListener("click", () => {
      selectGif(full.url, result.title || "GIF");
    });
    return item;
  }

  function renderAdItem(ad: GifResult): HTMLElement | null {
    if (!ad.content) return null;
    const wrapper = document.createElement("div");
    wrapper.className = "gif-picker-ad";
    const w = Math.min(ad.width || AD_MAX_WIDTH, AD_MAX_WIDTH);
    const h = Math.min(ad.height || AD_MAX_HEIGHT, AD_MAX_HEIGHT);
    const iframeUrlMatch = ad.content.match(/<iframe[^>]+src="([^"]+)"/);
    const adIframeUrl = iframeUrlMatch ? iframeUrlMatch[1] : null;
    if (!adIframeUrl) return null;
    const iframe = document.createElement("iframe");
    iframe.src = adIframeUrl;
    iframe.setAttribute("sandbox", "allow-scripts allow-popups allow-top-navigation");
    iframe.scrolling = "no";
    iframe.style.width = `${w}px`;
    iframe.style.height = `${h}px`;
    iframe.style.border = "none";
    iframe.style.display = "block";
    wrapper.style.setProperty("--ad-height", `${h}px`);
    wrapper.appendChild(iframe);
    return wrapper;
  }

  // ── Infinite scroll ───────────────────────────────────────────────────────

  function handleGridScroll(): void {
    if (!gridEl || isLoading || !hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = gridEl;
    const threshold = 80;
    if (scrollTop + clientHeight >= scrollHeight - threshold) {
      loadNextPage();
    }
  }

  // ── State helpers ─────────────────────────────────────────────────────────

  function showLoading(): void {
    if (!gridEl) return;
    gridEl.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "gif-picker-loading";
    loading.textContent = "Loading\u2026";
    gridEl.appendChild(loading);
  }

  function showPageLoading(): void {
    if (!gridEl) return;
    const loading = document.createElement("div");
    loading.className = "gif-picker-page-loading";
    loading.textContent = "Loading\u2026";
    gridEl.appendChild(loading);
  }

  function showEmptyMessage(message: string): void {
    if (!gridEl) return;
    gridEl.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "gif-picker-empty";
    empty.textContent = message;
    gridEl.appendChild(empty);
  }

  function showError(): void {
    showEmptyMessage("Failed to load GIFs.");
  }

  // ── Select and send GIF ───────────────────────────────────────────────────

  function selectGif(url: string, title: string): void {
    closePanel();
    window.sendGif?.(url, title);
  }

  // ── Positioning ───────────────────────────────────────────────────────────

  function positionPanel(trigger: HTMLElement): void {
    if (!panel) return;
    const rect = trigger.getBoundingClientRect();
    const panelWidth = 360;
    const panelHeight = 450;
    let left = rect.left;
    let top = rect.top - panelHeight - 8;
    if (left + panelWidth > window.innerWidth - 8) {
      left = window.innerWidth - panelWidth - 8;
    }
    if (left < 8) left = 8;
    if (top < 8) top = rect.bottom + 8;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  // ── Open / close ──────────────────────────────────────────────────────────

  function openPanel(trigger: HTMLElement): void {
    if (!panel) {
      init().then(() => {
        if (panel) openPanel(trigger);
      });
      return;
    }
    if (!panel.classList.contains("hidden") && triggerEl === trigger) {
      closePanel();
      return;
    }
    triggerEl = trigger;
    positionPanel(trigger);
    panel.classList.remove("hidden");
    // Always open on search tab
    switchToTab("search");
    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
    }
    startTrending();
    outsideClickHandler = (e: MouseEvent) => {
      if (!panel!.contains(e.target as Node) && e.target !== trigger) {
        closePanel();
      }
    };
    setTimeout(() => document.addEventListener("click", outsideClickHandler!), 0);
    escKeyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", escKeyHandler);
  }

  function closePanel(): void {
    if (!panel) return;
    panel.classList.add("hidden");
    triggerEl = null;
    hideAutocomplete();
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (autocompleteTimer !== null) {
      clearTimeout(autocompleteTimer);
      autocompleteTimer = null;
    }
    if (outsideClickHandler) {
      document.removeEventListener("click", outsideClickHandler);
      outsideClickHandler = null;
    }
    if (escKeyHandler) {
      document.removeEventListener("keydown", escKeyHandler);
      escKeyHandler = null;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.openGifPicker = function (trigger: HTMLElement): void {
    if (!panel) {
      init().then(() => {
        if (panel) openPanel(trigger);
      });
      return;
    }
    openPanel(trigger);
  };

  window.getGifFavorites = function (): GifFavorite[] {
    return getFavorites();
  };

  window.addGifFavorite = function (favorite: GifFavorite): void {
    addFavorite(favorite);
  };

  window.removeGifFavorite = function (url: string): void {
    removeFavorite(url);
  };

  window.isGifFavorited = function (url: string): boolean {
    return isFavorited(url);
  };

  init();
})();
