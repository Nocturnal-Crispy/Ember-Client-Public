(function (): void {
  const log = window.emberLog.createLogger("UpdateNotifier");

  /** Version that was dismissed by the user — skip showing it again this session. */
  let dismissedVersion: string | null = null;

  const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  const NOTIFICATION_ID = "ember-update-notification";

  function createNotificationElement(latestVersion: string): HTMLElement {
    const container = document.createElement("button");
    container.id = NOTIFICATION_ID;
    container.className = "update-notification";
    container.setAttribute(
      "aria-label",
      `Update available: v${latestVersion}. Click to view details.`
    );
    container.addEventListener("click", () => {
      openUpdateDetails();
    });

    const icon = document.createElement("span");
    icon.className = "update-notification__icon";
    icon.textContent = "↑";

    const text = document.createElement("span");
    text.className = "update-notification__text";
    text.textContent = `Update available v${latestVersion}`;

    const dismiss = document.createElement("span");
    dismiss.className = "update-notification__dismiss";
    dismiss.setAttribute("role", "button");
    dismiss.setAttribute("aria-label", "Dismiss update notification");
    dismiss.textContent = "✕";
    dismiss.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissUpdateNotification();
    });

    container.appendChild(icon);
    container.appendChild(text);
    container.appendChild(dismiss);
    return container;
  }

  function showNotification(latestVersion: string): void {
    const existing = document.getElementById(NOTIFICATION_ID);
    if (existing) {
      const textEl = existing.querySelector(".update-notification__text");
      if (textEl) textEl.textContent = `Update available v${latestVersion}`;
      return;
    }
    const windowControls = document.querySelector(".window-controls");
    if (!windowControls) {
      log.warn("Could not find .window-controls to insert update notification");
      return;
    }
    const minimizeBtn = document.getElementById("minimize-btn");
    const el = createNotificationElement(latestVersion);
    windowControls.insertBefore(el, minimizeBtn);
    log.info("Update notification shown", { latestVersion });
  }

  function removeNotification(): void {
    const existing = document.getElementById(NOTIFICATION_ID);
    if (existing) {
      existing.remove();
    }
  }

  function dismissUpdateNotification(): void {
    const existing = document.getElementById(NOTIFICATION_ID);
    if (existing) {
      const textEl = existing.querySelector(".update-notification__text");
      const match = textEl?.textContent?.match(/v([\d.]+)$/);
      if (match) {
        dismissedVersion = match[1];
        log.debug("Update notification dismissed", { dismissedVersion });
      }
      existing.remove();
    }
  }

  /** Cached details from the last successful check — used when user clicks the notification. */
  let cachedDetails: UpdateDetails | null = null;

  function openUpdateDetails(): void {
    if (cachedDetails && typeof window.openUpdateModal === "function") {
      window.openUpdateModal(cachedDetails);
    }
  }

  async function checkForUpdate(): Promise<void> {
    try {
      // Fetch the skipped version once to compare
      const skippedVersion = (await window.electronAPI.ipc.invoke(
        "get-skipped-version"
      )) as string | null;

      const details = (await window.electronAPI.ipc.invoke(
        "check-for-update-details"
      )) as UpdateDetails;

      if (details.updateAvailable && details.latestVersion) {
        // Respect both session-dismissed and permanently-skipped versions
        if (
          details.latestVersion === dismissedVersion ||
          details.latestVersion === skippedVersion
        ) {
          log.debug("Skipping notification for dismissed/skipped version", {
            version: details.latestVersion,
          });
          removeNotification();
          return;
        }
        cachedDetails = details;
        showNotification(details.latestVersion);
      } else {
        cachedDetails = null;
        removeNotification();
      }
    } catch (err) {
      log.debug("Update check error", { error: String(err) });
    }
  }

  // Initial check on module load
  checkForUpdate();

  // Periodic re-check
  setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

  // Exports
  window.checkForUpdate = checkForUpdate;
  window.dismissUpdateNotification = dismissUpdateNotification;
})();
