# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> For monorepo-level architecture (ember-server, ember-mobile), see `../CLAUDE.md`.

---

## Commands

```bash
npm install                          # Install dependencies (rebuilds better-sqlite3)
npm run build                        # inject-key + tsc (main + renderer) → dist/
npm run dev                          # rebuild better-sqlite3 + build + electron (NODE_ENV=development)
npm start                            # build + electron .
npm test                             # Jest (tests/jest.config.ts)
npm test -- --watch
npm test -- --coverage
npm test -- tests/unit/path/to/test.test.ts   # single test file
npm run test:e2e                     # Playwright E2E tests
npm run dist:linux                   # secure-build + AppImage + deb
npm run dist:win                     # secure-build + nsis + portable
npm run dist:mac                     # secure-build + dmg + zip
npm run lint:fix                     # Auto-fix lint + formatting (Prettier via ESLint)
npm run lint                         # Check only
./scripts/release.sh                 # tests → version bump → dist → GitHub release
```

## Source vs. Compiled

Always edit TypeScript sources; compiled JS is auto-generated:

| Source                 | Output                       |
| ---------------------- | ---------------------------- |
| `src/main/*.ts`        | `dist/main/*.js`             |
| `src/preload/*.ts`     | `dist/preload/*.js`          |
| `src/renderer/**/*.ts` | `dist/renderer/**/*.js`      |

Three tsconfig files:
- `tsconfig.json` — base config with path aliases (`ember-shared` → `src/shared`)
- `tsconfig.main.json` — main process + preload → `dist/` (CommonJS)
- `tsconfig.renderer.json` — renderer scripts → `dist/renderer/` (ES2020, `module: "none"`)

---

## Architecture

### ember-shared

`ember-shared` is embedded within ember-client at `src/shared/` (not a separate monorepo directory). It is resolved via tsconfig path alias:

```
ember-shared → src/shared (path alias in tsconfig.json)
```

In tests, it is resolved via Jest `moduleNameMapper` to the same source path.

Functions exposed via `contextBridge` in `preload.ts`:

- `window.electronAPI.authService.*` — login, register, form validation
- `window.electronAPI.messageService.*` — fetch/send encrypted messages
- `window.electronAPI.emberService.*` — fetch ember list
- `window.electronAPI.channelService.*` — fetch channels, fetch ember key
- `window.electronAPI.wsService.buildWsUrl` — construct WebSocket URL
- `window.electronAPI.crypto.*` — NaCl key gen, encrypt/decrypt (async PBKDF2 paths)
- `window.electronAPI.nacl.*` / `window.electronAPI.naclUtil.*` — raw NaCl primitives

### IPC Channel Allowlists (preload.ts)

Changes to IPC channels must be reflected in both `preload.ts` allowlists and `src/main.ts` handlers:

```
ALLOWED_SEND:   window-minimize, window-maximize, window-close, auth-success, auth-logout, log-to-console
ALLOWED_INVOKE: get-device-identity, save-device-identity, get-auth, save-auth,
                get-last-hostname, get-voice-video-settings, save-voice-video-settings
ALLOWED_ON:     handle-invite-link
```

### Renderer Bootstrap

`src/renderer/index.html` has a single `<script defer>` pointing to `main-loader.js`. At `DOMContentLoaded`, `main-loader` fetches all HTML fragments in parallel, assembles the DOM, then loads **34 scripts sequentially** in dependency order:

```
logger → theme-manager → auth-loader → signal-service → signal-session-manager →
history-crypto-service → app-state → voice-service → websocket-service →
user-service → user-details-modal → username-click-handler → messages-area →
format-toolbar → crypto-routing-service → message-service → channel-manager →
ember-manager → invite-manager → screen-share-modal → voice-ui-manager →
provisioning-service → notification-settings → plugin-settings → app-lock-manager →
update-notifier → update-modal → version-display → direct-messaging-manager →
direct-messaging-ui → read-all-manager → emoji-picker → gif-picker → renderer
```

HTML fragments live in `src/renderer/*.html` (one per UI section/modal).
CSS files live in `src/renderer/styles/` — one file per concern.

### Renderer Module Pattern (IIFE)

All renderer modules **except** `renderer.js` must use an IIFE to avoid `SyntaxError: Identifier already declared` in shared global scope:

```javascript
(function (): void {
  const log = window.emberLog.createLogger('ModuleName');
  // ... functions ...
  window.myExportedFunc = myExportedFunc; // explicit export to global
})();
```

`renderer.js` is a plain top-level script; its `function` declarations auto-become globals.

All globally exported functions/properties are typed in `src/renderer/types/globals.d.ts` — update this file when adding or renaming renderer globals or IPC channels.

### Global Types

`src/renderer/types/globals.d.ts` re-exports all domain types from `ember-shared` as `global` type aliases so renderer scripts don't need `import` statements (which would cause TypeScript to emit incompatible CommonJS boilerplate).

---

## Testing

Jest config: `tests/jest.config.ts` (rootDir is `../`, tests live in `tests/`).

| Test type             | Location                                    | Import depth       |
| --------------------- | ------------------------------------------- | ------------------ |
| Unit — managers       | `tests/unit/managers/`                      | `../../../src/...` |
| Unit — services/utils | `tests/unit/services/`, `tests/unit/utils/` | `../../../src/...` |
| Integration           | `tests/integration/`                        | `../../src/...`    |

- Crypto and integration tests require `@jest-environment node` (for SubtleCrypto).
- IIFE module tests: set up `window.App`, `window.electronAPI`, `window.emberLog` mocks in `beforeAll`, then `require()` the module.

---

## Linting & Formatting

**After every editing session**, run lint to check and fix your changes:

```bash
npm run lint:fix    # Auto-fix lint + formatting errors (Prettier runs as ESLint plugin)
npm run lint        # Check only (no modifications)
```

- Prettier is integrated into ESLint via `eslint-plugin-prettier` — there is NO standalone Prettier
- Config: `eslint.config.mjs` (ES module format)
- Prettier settings (singleQuote, semi, trailingComma es5, printWidth 100) are inline in the ESLint config
- Always run `npm run lint:fix` before committing

---

## Code Style

- **Naming**: PascalCase classes, camelCase functions/variables, kebab-case filenames
- **Functions**: start with a verb; `isX`/`hasX`/`canX` for booleans; `executeX`/`saveX` for void actions; <20 instructions
- **Classes**: <200 instructions, <10 public methods; prefer composition
- **Types**: always declare; no `any`; `readonly` for immutable data; one export per file
- **DOM**: no `innerHTML` — use `createElement`, `textContent`, `replaceChildren`
- **Never log**: tokens, private keys, ember keys, recovery codes, message content, invite codes, SDP/ICE data, or WebSocket URLs containing tokens
