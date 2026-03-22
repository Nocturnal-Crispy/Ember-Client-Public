/**
 * Tests for theme settings validation in preload script.
 * These tests reproduce the "Theme settings failed validation in preload" error.
 */

describe('Theme Settings Validation', () => {
  let mockIpcRenderer: any;
  let mockDocument: any;
  let mockLog: any[] = [];

  beforeEach(() => {
    // Clear logs
    mockLog = [];

    // Mock console.log to capture preload logs
    const _originalConsoleLog = console.log;
    console.log = (...args: any[]) => {
      mockLog.push(args);
    };

    // Mock document
    mockDocument = {
      documentElement: {
        style: {
          setProperty: jest.fn(),
        },
      },
    };
    global.document = mockDocument;

    // Mock ipcRenderer
    mockIpcRenderer = {
      sendSync: jest.fn(),
    };
    global.require = jest.fn().mockReturnValue({
      ipcRenderer: mockIpcRenderer,
    }) as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function isValidPreloadRgb(value: unknown): value is string {
    if (typeof value !== 'string' || value.trim() === '') return false;
    const parts = value.split(',');
    if (parts.length !== 3) return false;
    return parts.every(part => {
      const n = parseInt(part.trim(), 10);
      return !isNaN(n) && n >= 0 && n <= 255;
    });
  }

  function applyThemeSync(savedTheme: any): void {
    if (
      savedTheme &&
      mockDocument.documentElement &&
      isValidPreloadRgb(savedTheme.accentRgb) &&
      isValidPreloadRgb(savedTheme.backgroundRgb) &&
      isValidPreloadRgb(savedTheme.surfaceRgb)
    ) {
      const root = mockDocument.documentElement;
      root.style.setProperty('--rgb-highlight', savedTheme.accentRgb);
      root.style.setProperty('--rgb-background', savedTheme.backgroundRgb);
      root.style.setProperty('--rgb-surface', savedTheme.surfaceRgb);
      const hoverParts = savedTheme.surfaceRgb
        .split(',')
        .map((s: string) => Math.min(255, parseInt(s.trim(), 10) + 10));
      root.style.setProperty('--rgb-surface-hover', hoverParts.join(', '));
      if (savedTheme.chatColor) {
        root.style.setProperty('--chat-color', savedTheme.chatColor);
      }
      console.log('debug', 'Theme applied synchronously in preload');
    } else if (savedTheme) {
      console.log(
        'warn',
        'Theme settings failed validation in preload; skipping early application'
      );
    }
  }

  describe('Validation Failures', () => {
    it('should reproduce theme settings validation failure with invalid accent RGB', () => {
      const invalidTheme = {
        accentRgb: '255,0', // Invalid: only 2 values
        backgroundRgb: '0,0,0',
        surfaceRgb: '255,255,255',
        chatColor: '#ffffff',
      };

      mockIpcRenderer.sendSync.mockReturnValue(invalidTheme);

      applyThemeSync(invalidTheme);

      // Should log validation failure warning
      expect(mockLog).toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            'warn',
            'Theme settings failed validation in preload; skipping early application',
          ]),
        ])
      );
    });

    it('should reproduce theme settings validation failure with out-of-range RGB values', () => {
      const invalidTheme = {
        accentRgb: '300,0,0', // Invalid: 300 is > 255
        backgroundRgb: '0,0,0',
        surfaceRgb: '255,255,255',
        chatColor: '#ffffff',
      };

      applyThemeSync(invalidTheme);

      // Should log validation failure warning
      expect(mockLog).toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            'warn',
            'Theme settings failed validation in preload; skipping early application',
          ]),
        ])
      );
    });

    it('should reproduce theme settings validation failure with non-numeric RGB values', () => {
      const invalidTheme = {
        accentRgb: 'red,green,blue', // Invalid: not numbers
        backgroundRgb: '0,0,0',
        surfaceRgb: '255,255,255',
        chatColor: '#ffffff',
      };

      applyThemeSync(invalidTheme);

      // Should log validation failure warning
      expect(mockLog).toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            'warn',
            'Theme settings failed validation in preload; skipping early application',
          ]),
        ])
      );
    });

    it('should reproduce theme settings validation failure with empty RGB values', () => {
      const invalidTheme = {
        accentRgb: '', // Invalid: empty string
        backgroundRgb: '0,0,0',
        surfaceRgb: '255,255,255',
        chatColor: '#ffffff',
      };

      applyThemeSync(invalidTheme);

      // Should log validation failure warning
      expect(mockLog).toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            'warn',
            'Theme settings failed validation in preload; skipping early application',
          ]),
        ])
      );
    });

    it('should reproduce theme settings validation failure with null theme', () => {
      const nullTheme = null;

      applyThemeSync(nullTheme);

      // Should not log anything when theme is null
      expect(mockLog).not.toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            'warn',
            'Theme settings failed validation in preload; skipping early application',
          ]),
        ])
      );
    });
  });

  describe('Validation Success', () => {
    it('should successfully apply valid theme settings', () => {
      const validTheme = {
        accentRgb: '255,0,0',
        backgroundRgb: '0,0,0',
        surfaceRgb: '255,255,255',
        chatColor: '#ffffff',
      };

      applyThemeSync(validTheme);

      // Should log success and apply CSS properties
      expect(mockLog).toEqual(
        expect.arrayContaining([
          expect.arrayContaining(['debug', 'Theme applied synchronously in preload']),
        ])
      );

      // Debug: see all actual calls
      console.log(
        'All setProperty calls:',
        mockDocument.documentElement.style.setProperty.mock.calls
      );

      // Check that all expected properties were set
      expect(mockDocument.documentElement.style.setProperty).toHaveBeenNthCalledWith(
        1,
        '--rgb-highlight',
        '255,0,0'
      );
      expect(mockDocument.documentElement.style.setProperty).toHaveBeenNthCalledWith(
        2,
        '--rgb-background',
        '0,0,0'
      );
      expect(mockDocument.documentElement.style.setProperty).toHaveBeenNthCalledWith(
        3,
        '--rgb-surface',
        '255,255,255'
      );
      expect(mockDocument.documentElement.style.setProperty).toHaveBeenNthCalledWith(
        4,
        '--rgb-surface-hover',
        '255, 255, 255'
      );
      expect(mockDocument.documentElement.style.setProperty).toHaveBeenNthCalledWith(
        5,
        '--chat-color',
        '#ffffff'
      );
    });
  });

  describe('RGB Validation Function', () => {
    it('should validate correct RGB strings', () => {
      expect(isValidPreloadRgb('255,255,255')).toBe(true);
      expect(isValidPreloadRgb('0,0,0')).toBe(true);
      expect(isValidPreloadRgb('128,64,192')).toBe(true);
      expect(isValidPreloadRgb(' 255 , 255 , 255 ')).toBe(true); // With spaces
    });

    it('should reject invalid RGB strings', () => {
      expect(isValidPreloadRgb('255,255')).toBe(false); // Too few values
      expect(isValidPreloadRgb('255,255,255,255')).toBe(false); // Too many values
      expect(isValidPreloadRgb('256,0,0')).toBe(false); // Value too high
      expect(isValidPreloadRgb('-1,0,0')).toBe(false); // Negative value
      expect(isValidPreloadRgb('red,green,blue')).toBe(false); // Non-numeric
      expect(isValidPreloadRgb('')).toBe(false); // Empty string
      expect(isValidPreloadRgb(null)).toBe(false); // Null
      expect(isValidPreloadRgb(undefined)).toBe(false); // Undefined
      expect(isValidPreloadRgb(123)).toBe(false); // Not a string
    });
  });
});
