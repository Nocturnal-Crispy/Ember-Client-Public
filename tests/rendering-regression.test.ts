/**
 * Regression test for ember-client rendering functionality
 * This test prevents the rendering issue from recurring by validating
 * the build process and file structure before application startup
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('Ember Client Rendering Regression Tests', () => {
  const projectRoot = join(__dirname, '..');
  const distPath = join(projectRoot, 'dist');
  const rendererDistPath = join(distPath, 'renderer');

  beforeEach(() => {
    // Ensure we're starting with a clean state
    // This test validates the build process itself
  });

  describe('Build Process Integrity', () => {
    it('should build successfully and create all required files', () => {
      // Run the build command
      try {
        execSync('npm run build', { cwd: projectRoot, stdio: 'pipe' });
      } catch (error) {
        fail(`Build failed: ${(error as Error).message}`);
      }

      // Verify dist folder exists
      expect(existsSync(distPath)).toBe(true);
      expect(existsSync(rendererDistPath)).toBe(true);
    });

    it('should have all required JavaScript files after build', () => {
      const requiredScripts = [
        "utils/logger.js",
        "managers/theme-manager.js",
        "utils/auth-loader.js",
        "managers/app-state.js",
        "services/voice-service.js",
        "services/websocket-service.js",
        "services/user-service.js",
        "components/user-details-modal.js",
        "utils/username-click-handler.js",
        "components/messages-area.js",
        "components/format-toolbar.js",
        "services/message-service.js",
        "managers/channel-manager.js",
        "managers/ember-manager.js",
        "managers/invite-manager.js",
        "components/screen-share-modal.js",
        "managers/voice-ui-manager.js",
        "managers/notification-settings.js",
        "managers/plugin-settings.js",
        "managers/app-lock-manager.js",
        "managers/update-notifier.js",
        "components/update-modal.js",
        "managers/version-display.js",
        "managers/direct-messaging-manager.js",
        "managers/direct-messaging-ui.js",
        "managers/read-all-manager.js",
        "managers/emoji-picker.js",
        "managers/gif-picker.js",
        "managers/renderer.js",
      ];

      const missingFiles: string[] = [];

      for (const script of requiredScripts) {
        const fullPath = join(rendererDistPath, script);
        if (!existsSync(fullPath)) {
          missingFiles.push(script);
        }
      }

      expect(missingFiles).toHaveLength(0);
    });

    it('should have all required HTML fragments after build', () => {
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

      const missingFragments: string[] = [];

      for (const fragment of requiredFragments) {
        const fullPath = join(rendererDistPath, fragment);
        if (!existsSync(fullPath)) {
          missingFragments.push(fragment);
        }
      }

      expect(missingFragments).toHaveLength(0);
    });

    it('should have valid main-loader.js with correct script paths', () => {
      const mainLoaderPath = join(rendererDistPath, 'utils/main-loader.js');
      expect(existsSync(mainLoaderPath)).toBe(true);

      const content = readFileSync(mainLoaderPath, 'utf8');
      
      // Verify main-loader contains expected patterns
      expect(content).toContain('main-loader');
      expect(content).toContain('SCRIPTS');
      expect(content).toContain('fetchFragment');
      expect(content).toContain('loadScript');
      expect(content).toContain('../../dist/renderer/');
    });

    it('should have valid login-loader.js', () => {
      const loginLoaderPath = join(rendererDistPath, 'utils/login-loader.js');
      expect(existsSync(loginLoaderPath)).toBe(true);

      const content = readFileSync(loginLoaderPath, 'utf8');
      expect(content).toContain('login-loader');
    });

    it('should have entry point HTML files with correct script references', () => {
      const indexPath = join(rendererDistPath, 'index.html');
      const loginPath = join(rendererDistPath, 'login.html');

      expect(existsSync(indexPath)).toBe(true);
      expect(existsSync(loginPath)).toBe(true);

      const indexContent = readFileSync(indexPath, 'utf8');
      const loginContent = readFileSync(loginPath, 'utf8');

      // Verify HTML files reference correct loader scripts
      expect(indexContent).toContain('../../dist/renderer/utils/main-loader.js');
      expect(loginContent).toContain('../../dist/renderer/utils/login-loader.js');
    });
  });

  describe('JavaScript File Integrity', () => {
    it('should have non-empty JavaScript files', () => {
      const criticalJsFiles = [
        'utils/main-loader.js',
        'utils/login-loader.js',
        'managers/renderer.js',
        'services/websocket-service.js',
        'managers/app-state.js'
      ];

      for (const file of criticalJsFiles) {
        const filePath = join(rendererDistPath, file);
        expect(existsSync(filePath)).toBe(true);

        const content = readFileSync(filePath, 'utf8');
        expect(content.length).toBeGreaterThan(100); // Should have substantial content
        expect(content.includes('function') || content.includes('class') || content.includes('const')).toBe(true);
      }
    });

    it('should have valid TypeScript compilation output', () => {
      // Check that compiled JavaScript files don't contain TypeScript syntax
      const jsFiles = [
        'utils/main-loader.js',
        'managers/renderer.js',
        'services/websocket-service.js'
      ];

      for (const file of jsFiles) {
        const filePath = join(rendererDistPath, file);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf8');
          
          // Should not contain actual TypeScript type annotations
          expect(content).not.toMatch(/:\s*(string|number|boolean|object|void|any)\s*[=,;)]/);
          expect(content).not.toMatch(/^interface\s+\w+/m);
          expect(content).not.toMatch(/^type\s+\w+\s*=/m);
        }
      }
    });
  });

  describe('Application Startup Validation', () => {
    it('should be able to validate build before startup', () => {
      // This test acts as a pre-flight check before starting the application
      const buildValidation = {
        hasDistFolder: existsSync(distPath),
        hasRendererFolder: existsSync(rendererDistPath),
        hasMainLoader: existsSync(join(rendererDistPath, 'utils/main-loader.js')),
        hasLoginLoader: existsSync(join(rendererDistPath, 'utils/login-loader.js')),
        hasIndexHtml: existsSync(join(rendererDistPath, 'index.html')),
        hasLoginHtml: existsSync(join(rendererDistPath, 'login.html')),
      };

      // All critical files must exist
      Object.values(buildValidation).forEach(value => {
        expect(value).toBe(true);
      });
    });
  });
});
