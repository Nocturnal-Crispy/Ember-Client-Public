import type { Config } from "jest";
import path from "node:path";

const config: Config = {
  // Your config lives in /tests, but your package root is one level up
  rootDir: path.resolve(__dirname, ".."),

  testEnvironment: "jsdom",

  // ✅ All tests live in /tests
  roots: ["<rootDir>/tests"],

  testMatch: [
    "<rootDir>/tests/**/*.(spec|test).(ts|tsx|js|jsx)",
  ],

  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],

  // Compile TypeScript via ts-jest; suppress diagnostics so test files
  // outside rootDir (src/) don't cause compilation failures.
  // Runtime behaviour is what tests verify.
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { diagnostics: false }],
  },

  // TS path alias @/* → src/*; resolve ember-shared to source for fast test compilation
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^ember-shared$": "<rootDir>/../ember-shared/src/index",
    "^ember-shared/(.*)$": "<rootDir>/../ember-shared/src/$1",
  },

  clearMocks: true,
  restoreMocks: true,

  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/build/"],
};

export default config;