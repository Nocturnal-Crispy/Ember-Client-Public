import type { Config } from 'jest';
import path from 'node:path';

const config: Config = {
  // Your config lives in /tests, but your package root is one level up
  rootDir: path.resolve(__dirname, '..'),

  testEnvironment: 'jsdom',

  // ✅ All tests live in /tests
  roots: ['<rootDir>/tests'],

  testMatch: ['<rootDir>/tests/**/*.(spec|test).(ts|tsx|js|jsx)'],

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],

  // Compile TypeScript via ts-jest; suppress diagnostics so test files
  // outside rootDir (src/) don't cause compilation failures.
  // Runtime behaviour is what tests verify.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }],
  },

  // Handle ES modules in node_modules (specifically Signal client)
  transformIgnorePatterns: ['node_modules/(?!(.*\\.mjs$|@signalapp/libsignal-client))'],

  // TS path alias @/* → src/*; resolve ember-shared to source for fast test compilation
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^ember-shared$': '<rootDir>/src/shared/index',
    '^ember-shared/(.*)$': '<rootDir>/src/shared/$1',
    // ESM-style TS imports in ember-shared use explicit `.js` extensions.
    // Map relative `.js` imports back to TypeScript sources for Jest.
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^electron$': '<rootDir>/tests/__mocks__/electron.ts',
    '^@signalapp/libsignal-client$': '<rootDir>/tests/__mocks__/signal-client.ts',
  },

  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],

  clearMocks: true,
  restoreMocks: true,

  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/build/', '/e2e/'],
};

export default config;
