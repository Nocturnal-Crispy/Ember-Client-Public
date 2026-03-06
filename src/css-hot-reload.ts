/**
 * CSS Hot-reload functionality
 * Watches for CSS file changes and injects them into the renderer
 */

import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';

interface CssHotReload {
  watchCssFiles: (mainWindow: BrowserWindow) => void;
  injectCss: (mainWindow: BrowserWindow, cssPath: string) => void;
}

const cssHotReload: CssHotReload = {
  /**
   * Watch for CSS file changes and hot-reload them
   */
  watchCssFiles(mainWindow: BrowserWindow) {
    // Use absolute path from project root
    const cssDir = path.join(process.cwd(), 'public/src/css');
    
    console.log('Looking for CSS directory at:', cssDir);
    
    if (!fs.existsSync(cssDir)) {
      console.log('CSS directory not found:', cssDir);
      return;
    }

    console.log('Starting CSS hot-reload watcher for:', cssDir);

    try {
      // Read all CSS files and watch them individually
      const cssFiles = fs.readdirSync(cssDir).filter(file => file.endsWith('.css'));
      
      console.log('Found CSS files:', cssFiles);
      
      cssFiles.forEach(cssFile => {
        const filePath = path.join(cssDir, cssFile);
        console.log('Watching CSS file:', filePath);
        
        // Watch each CSS file individually (non-recursive)
        fs.watchFile(filePath, (curr, prev) => {
          if (curr.mtime !== prev.mtime) {
            console.log('CSS file changed:', filePath);
            setTimeout(() => {
              this.injectCss(mainWindow, filePath);
            }, 100);
          }
        });
      });

      console.log('CSS hot-reload watcher started for:', cssDir);
    } catch (error) {
      console.error('Failed to start CSS watcher:', error);
    }
  },

  /**
   * Inject updated CSS into the renderer process
   */
  injectCss(mainWindow: BrowserWindow, cssPath: string) {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    try {
      const cssContent = fs.readFileSync(cssPath, 'utf8');
      const relativePath = path.relative(path.join(process.cwd(), 'public/src/css'), cssPath);
      
      console.log('CSS file changed:', cssPath);
      
      // Send the updated CSS to the renderer
      mainWindow.webContents.send('css-hot-reload', {
        path: relativePath,
        content: cssContent
      });
      
      // Force a reload of the renderer after a short delay
      setTimeout(() => {
        console.log('Forcing renderer reload...');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.reload();
        }
      }, 1000);
      
      console.log('CSS hot-reload message sent for:', relativePath);
    } catch (error) {
      console.error('Error injecting CSS:', error);
    }
  }
};

export default cssHotReload;
