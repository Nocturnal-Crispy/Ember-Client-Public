/**
 * Version Display Manager
 * 
 * Handles fetching and displaying the current app version in the persistent
 * version display element in the bottom-right corner.
 */

(function (): void {
  const log = window.emberLog.createLogger("VersionDisplay");

  /**
   * Update the version display with the current version
   */
  async function updateVersionDisplay(): Promise<void> {
    try {
      const versionElement = document.getElementById("version-number");
      if (!versionElement) {
        log.warn("Version display element not found");
        return;
      }

      // Get version info from the main process
      const updateInfo: UpdateInfo = await window.electronAPI.ipc.invoke(
        "CHECK_FOR_UPDATE"
      ) as UpdateInfo;
      
      if (updateInfo.currentVersion) {
        versionElement.textContent = updateInfo.currentVersion;
        log.info(`Version display updated to v${updateInfo.currentVersion}`);
      } else {
        // Fallback to package.json version if IPC fails
        versionElement.textContent = "0.0.31";
        log.warn("Failed to get version from main process, using fallback");
      }
    } catch (error) {
      log.error("Failed to update version display:", { error: String(error) });
      // Set fallback version
      const versionElement = document.getElementById("version-number");
      if (versionElement) {
        versionElement.textContent = "0.0.31";
      }
    }
  }

  /**
   * Initialize the version display
   */
  function initializeVersionDisplay(): void {
    // Update version immediately
    updateVersionDisplay();
    
    // Update version every 5 minutes (in case of updates)
    setInterval(updateVersionDisplay, 5 * 60 * 1000);
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeVersionDisplay);
  } else {
    initializeVersionDisplay();
  }
})();
