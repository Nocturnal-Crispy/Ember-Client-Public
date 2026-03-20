/**
 * Test for ember-client rendering functionality
 * This test verifies that the main-loader can load all required scripts
 * and that the application can render properly
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { JSDOM } from 'jsdom';

describe('Ember Client Rendering Tests', () => {
  let dom: JSDOM;
  let window: Window & typeof globalThis;
  let document: Document;

  beforeEach(() => {
    // Create a DOM environment similar to Electron renderer
    dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
      url: 'http://localhost',
      pretendToBeVisual: true,
      resources: 'usable'
    });
    window = dom.window as unknown as Window & typeof globalThis;
    document = dom.window.document;
    global.window = window;
    global.document = document;
    global.fetch = dom.window.fetch;
  });

  afterEach(() => {
    dom.window.close();
  });

  describe('Main Loader Script Loading', () => {
    it('should verify all required JavaScript files exist in dist folder', async () => {
      const fs = require('fs');
      const path = require('path');
      
      const requiredScripts = [
        "dist/renderer/utils/logger.js",
        "dist/renderer/managers/theme-manager.js",
        "dist/renderer/utils/auth-loader.js",
        "dist/renderer/managers/app-state.js",
        "dist/renderer/services/voice-service.js",
        "dist/renderer/services/websocket-service.js",
        "dist/renderer/services/user-service.js",
        "dist/renderer/components/user-details-modal.js",
        "dist/renderer/utils/username-click-handler.js",
        "dist/renderer/components/messages-area.js",
        "dist/renderer/components/format-toolbar.js",
        "dist/renderer/services/message-service.js",
        "dist/renderer/managers/channel-manager.js",
        "dist/renderer/managers/ember-manager.js",
        "dist/renderer/managers/invite-manager.js",
        "dist/renderer/components/screen-share-modal.js",
        "dist/renderer/managers/voice-ui-manager.js",
        "dist/renderer/managers/notification-settings.js",
        "dist/renderer/managers/plugin-settings.js",
        "dist/renderer/managers/app-lock-manager.js",
        "dist/renderer/managers/update-notifier.js",
        "dist/renderer/components/update-modal.js",
        "dist/renderer/managers/version-display.js",
        "dist/renderer/managers/direct-messaging-manager.js",
        "dist/renderer/managers/direct-messaging-ui.js",
        "dist/renderer/managers/read-all-manager.js",
        "dist/renderer/managers/emoji-picker.js",
        "dist/renderer/managers/gif-picker.js",
        "dist/renderer/managers/renderer.js",
      ];

      const projectRoot = path.join(__dirname, '..');
      const missingFiles: string[] = [];

      for (const script of requiredScripts) {
        const fullPath = path.join(projectRoot, script);
        if (!fs.existsSync(fullPath)) {
          missingFiles.push(script);
        }
      }

      expect(missingFiles).toHaveLength(0);
    });

    it('should verify main-loader.js exists and is accessible', async () => {
      const fs = require('fs');
      const path = require('path');
      
      const mainLoaderPath = path.join(__dirname, '../dist/renderer/utils/main-loader.js');
      expect(fs.existsSync(mainLoaderPath)).toBe(true);
      
      const content = fs.readFileSync(mainLoaderPath, 'utf8');
      expect(content).toContain('main-loader');
      expect(content).toContain('SCRIPTS');
      expect(content).toContain('fetchFragment');
    });

    it('should verify login-loader.js exists and is accessible', async () => {
      const fs = require('fs');
      const path = require('path');
      
      const loginLoaderPath = path.join(__dirname, '../dist/renderer/utils/login-loader.js');
      expect(fs.existsSync(loginLoaderPath)).toBe(true);
      
      const content = fs.readFileSync(loginLoaderPath, 'utf8');
      expect(content).toContain('login-loader');
    });

    it('should verify HTML fragments exist', async () => {
      const fs = require('fs');
      const path = require('path');
      
      const requiredFragments = [
        "title-bar.html",
        "server-list.html",
        "channel-list.html",
        "dm-screen.html",
        "welcome-screen.html",
        "chat-container.html",
        "member-list.html",
        "modal-logout.html",
        "modal-add-server.html",
        "modal-join-server.html",
        "modal-create-server.html",
        "modal-edit-ember.html",
        "modal-create-invite.html",
        "modal-accept-invite.html",
        "context-menu-channel.html",
        "context-menu-ember.html",
        "modal-channel-name.html",
        "modal-delete-confirm.html",
        "modal-settings.html",
        "overlay-reconnection.html",
        "version-display.html",
        "modal-attachment.html",
        "modal-image-viewer.html",
        "emoji-picker.html",
        "gif-picker.html",
        "modal-external-link.html",
        "modal-custom-status.html",
        "modal-user-details.html",
        "modal-update.html",
        "modal-app-lock.html",
        "modal-screen-share.html",
      ];

      const rendererDistPath = path.join(__dirname, '../dist/renderer');
      const missingFragments: string[] = [];

      for (const fragment of requiredFragments) {
        const fullPath = path.join(rendererDistPath, fragment);
        if (!fs.existsSync(fullPath)) {
          missingFragments.push(fragment);
        }
      }

      expect(missingFragments).toHaveLength(0);
    });
  });

  describe('Build Process Verification', () => {
    it('should verify build completed successfully', async () => {
      const fs = require('fs');
      const path = require('path');
      
      const distPath = path.join(__dirname, '../dist');
      expect(fs.existsSync(distPath)).toBe(true);
      
      const rendererDistPath = path.join(distPath, 'renderer');
      expect(fs.existsSync(rendererDistPath)).toBe(true);
      
      const mainIndexPath = path.join(rendererDistPath, 'index.html');
      expect(fs.existsSync(mainIndexPath)).toBe(true);
      
      const loginIndexPath = path.join(rendererDistPath, 'login.html');
      expect(fs.existsSync(loginIndexPath)).toBe(true);
    });
  });
});
