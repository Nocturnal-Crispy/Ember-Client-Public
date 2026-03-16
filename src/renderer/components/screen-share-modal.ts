/**
 * screen-share-modal.ts — Source picker for screen sharing.
 *
 * Exposes:
 *   window.openScreenShareModal(sources, audioAvailable, onSelect)
 *   window.hideScreenShareModal()
 *
 * DOM fragment (modal-screen-share.html) must be present before this runs.
 * Load order: after app-state.js.
 */
(function (): void {
  const log = window.emberLog.createLogger('ScreenShareModal');

  // ─── State ────────────────────────────────────────────────────────────────

  let _selectedSource: ScreenSource | null = null;
  let _onSelect: ((source: ScreenSource, settings: ScreenShareSettings) => void) | null = null;
  let _audioAvailable = false;

  // ─── DOM helpers ──────────────────────────────────────────────────────────

  function getEl<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
  }

  // ─── Source grid ──────────────────────────────────────────────────────────

  function buildSourceCard(source: ScreenSource): HTMLElement {
    const card = document.createElement('div');
    card.className = 'screen-share-source-card';
    card.dataset['sourceId'] = source.id;
    card.dataset['sourceType'] = source.type;

    const img = document.createElement('img');
    img.src = source.thumbnailDataUrl;
    img.alt = source.name;

    const nameEl = document.createElement('span');
    nameEl.className = 'screen-share-source-name';
    nameEl.dataset['sourceName'] = '';
    nameEl.textContent = source.name;

    card.appendChild(img);
    card.appendChild(nameEl);

    card.addEventListener('click', () => selectSource(source, card));

    return card;
  }

  function selectSource(source: ScreenSource, card: HTMLElement): void {
    _selectedSource = source;

    // Clear previous selection
    const grid = getEl('screen-share-source-grid');
    if (grid) {
      grid.querySelectorAll('[data-source-id]').forEach((el) => el.classList.remove('selected'));
    }
    card.classList.add('selected');

    // Enable confirm button
    const confirmBtn = getEl<HTMLButtonElement>('screen-share-confirm');
    if (confirmBtn) {
      confirmBtn.disabled = false;
    }
  }

  function renderSources(sources: ScreenSource[]): void {
    const grid = getEl('screen-share-source-grid');
    if (!grid) return;

    grid.replaceChildren();
    for (const source of sources) {
      grid.appendChild(buildSourceCard(source));
    }
  }

  // ─── Audio availability ───────────────────────────────────────────────────

  function applyAudioAvailability(audioAvailable: boolean): void {
    _audioAvailable = audioAvailable;

    const cb = getEl<HTMLInputElement>('screen-share-audio-checkbox');
    const status = getEl('screen-share-audio-status');

    if (!cb || !status) return;

    if (audioAvailable) {
      cb.disabled = false;
      status.textContent = 'System audio capture available';
    } else {
      cb.checked = false;
      cb.disabled = true;
      status.textContent = 'System audio capture not available on this system';
    }
  }

  // ─── Settings helpers ─────────────────────────────────────────────────────

  function currentSettings(): ScreenShareSettings {
    const resolution = (getEl<HTMLSelectElement>('screen-share-resolution')?.value ?? '720p') as
      ScreenShareSettings['resolution'];
    const frameRateRaw = parseInt(
      getEl<HTMLSelectElement>('screen-share-framerate')?.value ?? '15',
      10
    );
    const frameRate = (
      frameRateRaw === 30 ? 30 : frameRateRaw === 60 ? 60 : 15
    ) as ScreenShareSettings['frameRate'];
    const includeAudio =
      _audioAvailable &&
      (getEl<HTMLInputElement>('screen-share-audio-checkbox')?.checked ?? false);

    return {
      sourceId: _selectedSource?.id ?? '',
      includeAudio,
      resolution,
      frameRate,
    };
  }

  // ─── Open / Hide ──────────────────────────────────────────────────────────

  function openScreenShareModal(
    sources: ScreenSource[],
    audioAvailable: boolean,
    onSelect: (source: ScreenSource, settings: ScreenShareSettings) => void
  ): void {
    log.debug('Opening screen share modal', { sourceCount: sources.length, audioAvailable });

    _selectedSource = null;
    _onSelect = onSelect;

    // Reset confirm button
    const confirmBtn = getEl<HTMLButtonElement>('screen-share-confirm');
    if (confirmBtn) {
      confirmBtn.disabled = true;
    }

    // Reset settings
    const resolutionSel = getEl<HTMLSelectElement>('screen-share-resolution');
    if (resolutionSel) resolutionSel.value = '720p';
    const framerateSel = getEl<HTMLSelectElement>('screen-share-framerate');
    if (framerateSel) framerateSel.value = '15';
    const cb = getEl<HTMLInputElement>('screen-share-audio-checkbox');
    if (cb) cb.checked = false;

    renderSources(sources);
    applyAudioAvailability(audioAvailable);

    const modal = getEl('screen-share-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  function hideScreenShareModal(): void {
    log.debug('Hiding screen share modal');
    const modal = getEl('screen-share-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
    _selectedSource = null;
    _onSelect = null;
  }

  // ─── Confirm action ───────────────────────────────────────────────────────

  function handleConfirm(): void {
    if (!_selectedSource || !_onSelect) return;

    const source = _selectedSource;
    const settings = currentSettings();
    const callback = _onSelect;

    log.info('Screen share confirmed', { sourceId: source.id });
    hideScreenShareModal();
    callback(source, settings);
  }

  // ─── Event wiring ─────────────────────────────────────────────────────────

  function wireEvents(): void {
    // Close button
    getEl('screen-share-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      hideScreenShareModal();
    });

    // Backdrop click
    const modal = getEl('screen-share-modal');
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) {
        hideScreenShareModal();
      }
    });

    // ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const m = getEl('screen-share-modal');
        if (m && !m.classList.contains('hidden')) {
          hideScreenShareModal();
        }
      }
    });

    // Confirm button
    getEl('screen-share-confirm')?.addEventListener('click', () => {
      handleConfirm();
    });
  }

  wireEvents();

  // ─── Expose globals ───────────────────────────────────────────────────────

  window.openScreenShareModal = openScreenShareModal;
  window.hideScreenShareModal = hideScreenShareModal;
})();
