/**
 * Development hot-reloading configuration
 * This file is only included in development builds
 */

// Check if we're in development mode
const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

if (isDev) {
  try {
    // Enable hot-reloading for the main process with simpler config
    require('electron-reload')(__dirname, {
      hardResetMethod: 'exit'
    });
  } catch (error) {
    console.log('Hot-reloading not available:', error);
  }
}

export { isDev };
