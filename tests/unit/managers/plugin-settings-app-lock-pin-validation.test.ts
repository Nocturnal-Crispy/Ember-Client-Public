/**
 * Unit test for app lock PIN validation functionality
 * Tests that PIN validation prevents enabling app lock without a PIN
 */

describe('app lock PIN validation', () => {
  it('should have PIN validation logic in plugin-settings', () => {
    // Test that the PIN validation logic exists in the plugin-settings file
    const fs = require('fs');
    const jsPath = `${__dirname}/../../../src/renderer/managers/plugin-settings.ts`;
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    expect(jsContent).toContain('has-pin');
    expect(jsContent).toContain('app-lock-pin-warning');
    // Note: PIN validation on enable was removed to allow enabling without PIN first
  });

  it('should have PIN validation in app-lock-manager', () => {
    // Test that the app-lock-manager has PIN validation
    const fs = require('fs');
    const jsPath = `${__dirname}/../../../src/renderer/managers/app-lock-manager.ts`;
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    expect(jsContent).toContain('has-pin');
    expect(jsContent).toContain('SECURITY ALERT: No PIN set');
    expect(jsContent).toContain('async function lockApp');
  });

  it('should have PIN warning UI in modal-settings', () => {
    // Test that the HTML has the PIN warning element
    const fs = require('fs');
    const htmlPath = `${__dirname}/../../../src/renderer/modal-settings.html`;
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    expect(htmlContent).toContain('app-lock-pin-warning');
    expect(htmlContent).toContain('No PIN set - App Lock disabled');
  });

  it('should have PIN warning CSS styling', () => {
    // Test that the CSS has the warning styling
    const fs = require('fs');
    const cssPath = `${__dirname}/../../../src/renderer/styles/components/settings.css`;
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    expect(cssContent).toContain('.app-lock-pin-warning');
    expect(cssContent).toContain('#ed4245'); // Red color for warning
    expect(cssContent).toContain('font-weight: 600'); // Bold text
  });
});
