/**
 * TDD Tests for Preload Script Issues
 * These tests reproduce the issues identified in the log file
 */

import { describe, it, expect } from '@jest/globals';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('Preload Script Issues - TDD GREEN Phase', () => {
  const projectRoot = join(__dirname, '..');
  const distPath = join(projectRoot, 'dist');
  const preloadDistPath = join(distPath, 'preload');

  describe('Issue 1: Missing Preload Script', () => {
    it('should PASS when preload script exists (GREEN)', () => {
      const preloadIndexPath = join(preloadDistPath, 'index.js');

      // This test should PASS now - we fixed the issue
      expect(existsSync(preloadIndexPath)).toBe(true);
    });

    it('should PASS when reading existing preload script', () => {
      const preloadIndexPath = join(preloadDistPath, 'index.js');

      expect(() => {
        readFileSync(preloadIndexPath, 'utf8');
      }).not.toThrow();
    });
  });

  describe('Issue 2: Missing tweetnacl Module', () => {
    it('should PASS when tweetnacl is NOT imported in preload', () => {
      const preloadIndexPath = join(preloadDistPath, 'index.js');

      if (existsSync(preloadIndexPath)) {
        const content = readFileSync(preloadIndexPath, 'utf8');

        // Check that tweetnacl is NOT imported
        const hasTweetNaclImport =
          content.includes('tweetnacl') || content.includes("require('tweetnacl')");

        expect(hasTweetNaclImport).toBe(false);
      } else {
        fail('Preload script should exist');
      }
    });

    it('should PASS when tweetnacl-util is NOT imported in preload', () => {
      const preloadIndexPath = join(preloadDistPath, 'index.js');

      if (existsSync(preloadIndexPath)) {
        const content = readFileSync(preloadIndexPath, 'utf8');

        // Check that tweetnacl-util is NOT imported
        const hasTweetNaclUtilImport =
          content.includes('tweetnacl-util') || content.includes("require('tweetnacl-util')");

        expect(hasTweetNaclUtilImport).toBe(false);
      } else {
        fail('Preload script should exist');
      }
    });
  });

  describe('Issue 3: electronAPI.ipc Undefined Errors', () => {
    it('should PASS when electronAPI is properly exposed', () => {
      const preloadIndexPath = join(preloadDistPath, 'index.js');

      if (existsSync(preloadIndexPath)) {
        const content = readFileSync(preloadIndexPath, 'utf8');

        // Check if electronAPI is exposed with ipc property
        const hasElectronAPI = content.includes('electronAPI') || content.includes('contextBridge');
        const hasIPCExposure = content.includes('ipcRenderer') || content.includes('.ipc');

        expect(hasElectronAPI).toBe(true);
        expect(hasIPCExposure).toBe(true);
      } else {
        fail('Preload script should exist');
      }
    });

    it('should PASS when electronAPI.ipc is available', () => {
      const preloadIndexPath = join(preloadDistPath, 'index.js');

      if (existsSync(preloadIndexPath)) {
        const content = readFileSync(preloadIndexPath, 'utf8');

        // Check that electronAPI.ipc is properly exposed
        const hasElectronAPIIPC =
          content.includes('ipc:') && content.includes('contextBridge.exposeInMainWorld');

        expect(hasElectronAPIIPC).toBe(true);
      } else {
        fail('Preload script should exist');
      }
    });
  });
});
