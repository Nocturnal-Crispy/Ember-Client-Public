/**
 * update-modal.ts
 *
 * Renders and manages the in-app update modal. Handles the full download and
 * installation flow, including progress display and user action buttons.
 *
 * Must load after update-notifier.js in main-loader.
 */
(function (): void {
  const log = window.emberLog.createLogger('UpdateModal');

  // ─── State ────────────────────────────────────────────────────────────────

  type ModalPhase = 'idle' | 'downloading' | 'downloaded' | 'installing';

  let currentDetails: UpdateDetails | null = null;
  let downloadedFilePath: string | null = null;
  let currentPhase: ModalPhase = 'idle';

  // ─── DOM helpers ──────────────────────────────────────────────────────────

  function getEl(id: string): HTMLElement | null {
    return document.getElementById(id);
  }

  function setText(id: string, text: string): void {
    const el = getEl(id);
    if (el) el.textContent = text;
  }

  function setHidden(id: string, hidden: boolean): void {
    const el = getEl(id);
    if (!el) return;
    if (hidden) {
      el.classList.add('hidden');
    } else {
      el.classList.remove('hidden');
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // ─── Progress updates ─────────────────────────────────────────────────────

  function updateProgress(progress: DownloadProgress): void {
    const fill = getEl('update-modal-progress-fill') as HTMLElement | null;
    if (fill) fill.style.width = `${progress.percentage}%`;
    setText(
      'update-modal-progress-text',
      `${progress.percentage}% — ${formatBytes(progress.bytesDownloaded)} / ${formatBytes(progress.totalBytes)}`
    );
  }

  function setStatus(message: string, isError = false): void {
    const el = getEl('update-modal-status');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('update-modal-status--error', isError);
    setHidden('update-modal-status', false);
  }

  function clearStatus(): void {
    setHidden('update-modal-status', true);
  }

  // ─── Phase transitions ────────────────────────────────────────────────────

  function transitionToDownloading(): void {
    currentPhase = 'downloading';
    setHidden('update-modal-progress', false);
    clearStatus();

    const downloadBtn = getEl('update-modal-download-btn') as HTMLButtonElement | null;
    const exitBtn = getEl('update-modal-exit-btn') as HTMLButtonElement | null;
    const skipBtn = getEl('update-modal-skip-btn') as HTMLButtonElement | null;

    if (downloadBtn) {
      downloadBtn.textContent = 'Cancel Download';
      downloadBtn.disabled = false;
    }
    if (exitBtn) exitBtn.disabled = true;
    if (skipBtn) skipBtn.disabled = true;
  }

  function transitionToDownloaded(filePath: string): void {
    currentPhase = 'downloaded';
    downloadedFilePath = filePath;

    const downloadBtn = getEl('update-modal-download-btn') as HTMLButtonElement | null;
    const exitBtn = getEl('update-modal-exit-btn') as HTMLButtonElement | null;
    const skipBtn = getEl('update-modal-skip-btn') as HTMLButtonElement | null;

    if (downloadBtn) {
      downloadBtn.textContent = 'Install Now';
      downloadBtn.disabled = false;
    }
    if (exitBtn) {
      exitBtn.textContent = 'Install on Exit';
      exitBtn.disabled = false;
    }
    if (skipBtn) skipBtn.disabled = false;

    setStatus('Download complete. Ready to install.');
  }

  function transitionToInstalling(): void {
    currentPhase = 'installing';

    const downloadBtn = getEl('update-modal-download-btn') as HTMLButtonElement | null;
    const exitBtn = getEl('update-modal-exit-btn') as HTMLButtonElement | null;
    const skipBtn = getEl('update-modal-skip-btn') as HTMLButtonElement | null;

    if (downloadBtn) {
      downloadBtn.textContent = 'Installing...';
      downloadBtn.disabled = true;
    }
    if (exitBtn) exitBtn.disabled = true;
    if (skipBtn) skipBtn.disabled = true;

    setStatus('Launching installer...');
  }

  function resetToIdle(): void {
    currentPhase = 'idle';
    downloadedFilePath = null;

    setHidden('update-modal-progress', true);
    clearStatus();

    const fill = getEl('update-modal-progress-fill') as HTMLElement | null;
    if (fill) fill.style.width = '0%';
    setText('update-modal-progress-text', '0%');

    const downloadBtn = getEl('update-modal-download-btn') as HTMLButtonElement | null;
    const exitBtn = getEl('update-modal-exit-btn') as HTMLButtonElement | null;
    const skipBtn = getEl('update-modal-skip-btn') as HTMLButtonElement | null;

    if (downloadBtn) {
      downloadBtn.textContent = 'Download & Install';
      downloadBtn.disabled = false;
    }
    if (exitBtn) {
      exitBtn.textContent = 'Install on Exit';
      exitBtn.disabled = false;
    }
    if (skipBtn) {
      skipBtn.textContent = 'Skip This Version';
      skipBtn.disabled = false;
    }
  }

  // ─── Download flow ────────────────────────────────────────────────────────

  async function startDownload(): Promise<void> {
    if (!currentDetails?.downloadUrl || !currentDetails.assetName || currentDetails.downloadSize === null) {
      setStatus('No download available for this platform.', true);
      return;
    }

    transitionToDownloading();
    log.info('Starting update download', { assetName: currentDetails.assetName });

    try {
      const result = await window.electronAPI.ipc.invoke(
        'download-update',
        currentDetails.downloadUrl,
        currentDetails.assetName,
        currentDetails.downloadSize
      ) as { filePath?: string; error?: string };

      if (result.error) {
        if (result.error.includes('socket hang up') || result.error.includes('destroyed')) {
          // Cancelled by user
          resetToIdle();
          return;
        }
        log.warn('Download failed', { error: result.error });
        setStatus(`Download failed: ${result.error}`, true);
        resetToIdle();
      } else if (result.filePath) {
        transitionToDownloaded(result.filePath);
      }
    } catch (err) {
      log.warn('Download error', { error: String(err) });
      setStatus(`Download error: ${String(err)}`, true);
      resetToIdle();
    }
  }

  async function cancelDownload(): Promise<void> {
    log.info('User cancelled download');
    await window.electronAPI.ipc.invoke('cancel-download');
    resetToIdle();
    setStatus('Download cancelled.');
  }

  async function installNow(): Promise<void> {
    if (!downloadedFilePath) return;
    transitionToInstalling();
    log.info('Installing update now');
    try {
      await window.electronAPI.ipc.invoke('install-update', downloadedFilePath);
    } catch (err) {
      log.warn('Install failed', { error: String(err) });
      setStatus(`Install failed: ${String(err)}`, true);
      resetToIdle();
    }
  }

  async function installOnExit(): Promise<void> {
    if (!downloadedFilePath) return;
    log.info('Scheduling update install on exit');
    await window.electronAPI.ipc.invoke('schedule-install-on-exit', downloadedFilePath);
    setStatus('Update will be installed when you close Ember.');
    const exitBtn = getEl('update-modal-exit-btn') as HTMLButtonElement | null;
    if (exitBtn) exitBtn.disabled = true;
  }

  async function skipVersion(): Promise<void> {
    if (!currentDetails?.latestVersion) return;
    log.info('User skipped version', { version: currentDetails.latestVersion });
    await window.electronAPI.ipc.invoke('skip-version', currentDetails.latestVersion);
    closeUpdateModal();
  }

  // ─── Download button logic ─────────────────────────────────────────────────

  async function handleDownloadBtnClick(): Promise<void> {
    if (currentPhase === 'idle') {
      await startDownload();
    } else if (currentPhase === 'downloading') {
      await cancelDownload();
    } else if (currentPhase === 'downloaded') {
      await installNow();
    }
  }

  // ─── IPC event listeners ──────────────────────────────────────────────────

  window.electronAPI.ipc.on('update-download-progress', (_event, progress) => {
    updateProgress(progress as DownloadProgress);
  });

  window.electronAPI.ipc.on('update-download-complete', (_event, data) => {
    const payload = data as { filePath: string; assetName: string };
    transitionToDownloaded(payload.filePath);
  });

  window.electronAPI.ipc.on('update-download-error', (_event, data) => {
    const payload = data as { error: string };
    log.warn('Download error event', { error: payload.error });
    setStatus(`Download failed: ${payload.error}`, true);
    resetToIdle();
  });

  // ─── Open / Close ──────────────────────────────────────────────────────────

  function openUpdateModal(details: UpdateDetails): void {
    log.info('Opening update modal', { latestVersion: details.latestVersion });
    currentDetails = details;
    resetToIdle();

    // Version header
    setText('update-modal-version', `v${details.currentVersion} → v${details.latestVersion}`);

    // Meta line (size + date)
    const metaParts: string[] = [];
    if (details.downloadSize) metaParts.push(formatBytes(details.downloadSize));
    if (details.publishedAt) {
      try {
        const date = new Date(details.publishedAt).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
        metaParts.push(`Released ${date}`);
      } catch {
        // ignore date format error
      }
    }
    setText('update-modal-meta', metaParts.join(' · '));

    // Release notes (plain text only — no innerHTML)
    const notesEl = getEl('update-modal-notes');
    if (notesEl) {
      notesEl.textContent = details.releaseNotes ?? 'No release notes available.';
    }

    // Hide download button if no asset available for platform
    const downloadBtn = getEl('update-modal-download-btn') as HTMLButtonElement | null;
    const exitBtn = getEl('update-modal-exit-btn') as HTMLButtonElement | null;
    if (!details.downloadUrl) {
      if (downloadBtn) downloadBtn.disabled = true;
      if (exitBtn) exitBtn.disabled = true;
    }

    const modal = getEl('update-modal');
    if (modal) modal.classList.remove('hidden');
  }

  function closeUpdateModal(): void {
    log.debug('Closing update modal');
    const modal = getEl('update-modal');
    if (modal) modal.classList.add('hidden');
    currentDetails = null;
  }

  // ─── Event wiring ─────────────────────────────────────────────────────────

  function wireEvents(): void {
    getEl('update-modal-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeUpdateModal();
    });

    getEl('update-modal')?.addEventListener('click', (e) => {
      if (e.target === getEl('update-modal')) closeUpdateModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = getEl('update-modal');
        if (modal && !modal.classList.contains('hidden')) closeUpdateModal();
      }
    });

    getEl('update-modal-download-btn')?.addEventListener('click', () => {
      handleDownloadBtnClick().catch((err) => log.warn('Download btn error', { error: String(err) }));
    });

    getEl('update-modal-exit-btn')?.addEventListener('click', () => {
      installOnExit().catch((err) => log.warn('Install on exit error', { error: String(err) }));
    });

    getEl('update-modal-skip-btn')?.addEventListener('click', () => {
      skipVersion().catch((err) => log.warn('Skip version error', { error: String(err) }));
    });
  }

  wireEvents();

  // ─── Exports ──────────────────────────────────────────────────────────────

  window.openUpdateModal = openUpdateModal;
  window.closeUpdateModal = closeUpdateModal;
})();
