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
    // Use absolute path from project root - updated to new styles directory
    const cssDir = path.join(process.cwd(), 'styles');
    
    console.log('Looking for CSS directory at:', cssDir);
    
    if (!fs.existsSync(cssDir)) {
      console.log('CSS directory not found:', cssDir);
      return;
    }

    console.log('Starting CSS hot-reload watcher for:', cssDir);

    try {
      // Recursively find all CSS files in the styles directory
      const findCssFiles = (dir: string): string[] => {
        const files: string[] = [];
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            files.push(...findCssFiles(fullPath));
          } else if (item.endsWith('.css')) {
            files.push(fullPath);
          }
        }
        
        return files;
      };
      
      const cssFiles = findCssFiles(cssDir);
      
      console.log('Found CSS files:', cssFiles);
      
      cssFiles.forEach(cssFile => {
        console.log('Watching CSS file:', cssFile);
        
        // Watch each CSS file individually (non-recursive)
        fs.watchFile(cssFile, (curr, prev) => {
          if (curr.mtime !== prev.mtime) {
            console.log('CSS file changed:', cssFile);
            setTimeout(() => {
              this.injectCss(mainWindow, cssFile);
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
      // Update path calculation for new styles directory structure
      const relativePath = path.relative(path.join(process.cwd(), 'styles'), cssPath);
      
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
