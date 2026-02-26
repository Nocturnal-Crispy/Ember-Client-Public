import type { Config } from "jest";
import path from "node:path";

const config: Config = {
  // Your config lives in /tests, but your package root is one level up
  rootDir: path.resolve(__dirname, ".."),

  preset: "ts-jest",
  testEnvironment: "jsdom", // use "node" if this is not a browser/React client

  // ✅ All tests live in /tests
  roots: ["<rootDir>/tests"],

  testMatch: [
    "<rootDir>/tests/**/*.(spec|test).(ts|tsx|js|jsx)",
  ],

  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],

  // Optional: TS path alias like "@/..."
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },

  clearMocks: true,
  restoreMocks: true,

  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/build/"],
};

export default config;