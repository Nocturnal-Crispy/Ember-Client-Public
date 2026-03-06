/**
 * CSS Hot-reload functionality for renderer process
 * Handles CSS injection from main process
 */

interface CssHotReloadMessage {
  path: string;
  content: string;
}

class CssHotReloader {
  private cssMap: Map<string, HTMLStyleElement> = new Map();

  constructor() {
    this.setupIpcListener();
  }

  /**
   * Set up IPC listener for CSS hot-reload messages
   */
  private setupIpcListener(): void {
    if (window.electronAPI) {
      window.electronAPI.onCssHotReload((message: CssHotReloadMessage) => {
        this.injectCss(message);
      });
    }
  }

  /**
   * Inject or update CSS in the DOM
   */
  private injectCss(message: CssHotReloadMessage): void {
    const { path, content } = message;
    
    console.log(`CSS changed, forcing page reload for: ${path}`);
    
    // Show reload indicator before reload
    this.showReloadIndicator(path);
    
    // Force a full page reload to ensure CSS changes are applied
    setTimeout(() => {
      console.log('Reloading page to apply CSS changes...');
      try {
        window.location.reload();
      } catch (error) {
        console.error('Failed to reload:', error);
        // Fallback: try alternative reload method
        window.location.href = window.location.href;
      }
    }, 500); // Small delay to show the indicator
  }

  /**
   * Force refresh a specific stylesheet by updating its href
   */
  private refreshStylesheet(cssPath: string): void {
    const cssFileName = cssPath.split('/').pop();
    
    // Find the original stylesheet link
    const stylesheets = document.querySelectorAll('link[rel="stylesheet"]') as NodeListOf<HTMLLinkElement>;
    stylesheets.forEach(sheet => {
      const href = sheet.getAttribute('href');
      if (href && href.includes(cssFileName || '')) {
        // Add cache-busting parameter to force refresh
        const newHref = href + '?t=' + Date.now();
        sheet.setAttribute('href', newHref);
        console.log(`Refreshed stylesheet: ${newHref}`);
        
        // Wait for the stylesheet to load and then force a reflow
        sheet.onload = () => {
          this.forceReflow();
        };
      }
    });
  }

  /**
   * Enhance CSS specificity to ensure hot-reload styles override originals
   */
  private enhanceCssSpecificity(css: string): string {
    let enhanced = css;
    
    // Add body selector to increase specificity
    enhanced = enhanced.replace(/([^{}]+)\s*\{/g, (match, selector) => {
      // Don't duplicate if it already has body
      if (selector.trim().startsWith('body') || selector.trim().startsWith('html')) {
        return match;
      }
      return `body ${selector.trim()} {`;
    });
    
    // Add !important to all properties for maximum override power
    enhanced = enhanced.replace(/([^:]+):\s*([^;]+);/g, '$1: $2 !important;');
    
    return enhanced;
  }

  /**
   * Disable original stylesheets to prevent conflicts
   */
  private disableOriginalStylesheets(hotReloadPath: string): void {
    const cssFileName = hotReloadPath.split('/').pop();
    
    // Find and disable the original stylesheet
    const stylesheets = document.querySelectorAll('link[rel="stylesheet"]') as NodeListOf<HTMLLinkElement>;
    stylesheets.forEach(sheet => {
      const href = sheet.getAttribute('href');
      if (href && href.includes(cssFileName || '')) {
        sheet.disabled = true;
        console.log(`Disabled original stylesheet: ${href}`);
      }
    });
  }

  /**
   * Force a reflow to ensure new styles are applied
   */
  private forceReflow(): void {
    // Force a reflow by accessing offsetHeight
    void document.body.offsetHeight;
    
    // Also try to force style recalculation
    const computedStyle = getComputedStyle(document.body);
    console.log('Current background:', computedStyle.background);
  }

  /**
   * Show a visual indicator when CSS is reloaded
   */
  private showReloadIndicator(cssPath: string): void {
    // Create or update reload indicator
    let indicator = document.getElementById('css-reload-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'css-reload-indicator';
      indicator.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: #4CAF50;
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        font-family: monospace;
        font-size: 12px;
        z-index: 10000;
        opacity: 0;
        transition: opacity 0.3s;
        pointer-events: none;
      `;
      document.body.appendChild(indicator);
    }
    
    indicator.textContent = `CSS: ${cssPath.split('/').pop()}`;
    indicator.style.opacity = '1';
    
    // Fade out after 2 seconds
    setTimeout(() => {
      indicator.style.opacity = '0';
    }, 2000);
    
    console.log(`CSS hot-reload triggered: ${cssPath}`);
  }

  /**
   * Remove all hot-reloaded CSS
   */
  cleanup(): void {
    this.cssMap.forEach((element) => {
      element.remove();
    });
    this.cssMap.clear();
  }
}

// Initialize CSS hot-reloader
const cssHotReloader = new CssHotReloader();

export default cssHotReloader;
