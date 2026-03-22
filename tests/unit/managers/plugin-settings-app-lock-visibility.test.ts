/**
 * Unit test for app lock conditional visibility functionality
 * Tests that the CSS classes and basic structure exist for conditional visibility
 */

describe('app lock conditional visibility', () => {
  it('should have CSS class for conditional visibility', () => {
    // Test that the CSS class exists by checking if our CSS modifications are present
    const fs = require('fs');
    const cssPath = `${__dirname}/../../../src/renderer/styles/components/settings.css`;
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    expect(cssContent).toContain('.app-lock-dependent');
    expect(cssContent).toContain('.app-lock-dependent.hidden');
    expect(cssContent).toContain('display: none');
  });

  it('should have HTML elements with app-lock-dependent class', () => {
    // Test that the HTML has been modified to include the conditional visibility classes
    const fs = require('fs');
    const htmlPath = `${__dirname}/../../../src/renderer/modal-settings.html`;
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    expect(htmlContent).toContain('app-lock-dependent');
    // Check that all the dependent options have the class
    expect(htmlContent).toMatch(/class="vv-row app-lock-dependent"/);
    expect(htmlContent).toMatch(/class="vv-toggle-row app-lock-dependent"/);
  });

  it('should have visibility update function in plugin-settings', () => {
    // Test that the visibility function exists in the plugin-settings file
    const fs = require('fs');
    const jsPath = `${__dirname}/../../../src/renderer/managers/plugin-settings.ts`;
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    expect(jsContent).toContain('updateAppLockDependentVisibility');
    expect(jsContent).toContain("querySelectorAll('.app-lock-dependent')");
    expect(jsContent).toContain("classList.add('hidden')");
    expect(jsContent).toContain("classList.remove('hidden')");
  });
});
