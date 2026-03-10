/**
 * Version Display Manager
 * 
 * Handles fetching and displaying the current app version in the persistent
 * version display element in the bottom-right corner.
 */

(function (): void {
  const log = window.emberLog.createLogger("VersionDisplay");

  /**
   * Get version from package.json
   */
  async function getPackageVersion(): Promise<string> {
    try {
      const response = await fetch('../../package.json');
      const packageJson = await response.json();
      return packageJson.version;
    } catch (error) {
      log.warn("Failed to read package.json:", { error: String(error) });
      return "NotFound"; // Final fallback
    }
  }

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
        "check-for-update"
      ) as UpdateInfo;
      
      if (updateInfo.currentVersion) {
        versionElement.textContent = updateInfo.currentVersion;
        log.info(`Version display updated to v${updateInfo.currentVersion}`);
      } else {
        // Fallback to package.json version if IPC fails
        const packageVersion = await getPackageVersion();
        versionElement.textContent = packageVersion;
        log.warn("Failed to get version from main process, using package.json version");
      }
    } catch (error) {
      log.error("Failed to update version display:", { error: String(error) });
      // Set fallback version from package.json
      const versionElement = document.getElementById("version-number");
      if (versionElement) {
        const packageVersion = await getPackageVersion();
        versionElement.textContent = packageVersion;
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
