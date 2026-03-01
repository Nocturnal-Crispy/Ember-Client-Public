# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> For monorepo-level architecture (ember-server, ember-mobile, PM2 setup), see `../CLAUDE.md`.

---

## Commands

```bash
npm install                          # Install dependencies (also rebuilds ember-shared)
npm run build                        # build:shared (../ember-shared) + tsc → public/src/js/
npm start                            # build + electron .
npm test                             # Jest (tests/jest.config.ts)
npm test -- --watch
npm test -- --coverage
npm test -- tests/unit/path/to/test.test.ts   # single test file
npm run dist:linux                   # AppImage + deb
npm run dist:win                     # nsis + portable
npm run dist:mac                     # dmg + zip
./scripts/release.sh                 # tests → version bump → dist → GitHub release
```

## Source vs. Compiled

Always edit TypeScript sources; compiled JS is auto-generated:

| Source | Output |
|--------|--------|
| `src/main.ts` | `public/src/js/main.js` |
| `src/preload.ts` | `public/src/js/preload.js` |
| `src/renderer/**/*.ts` | `public/src/js/**/*.js` |

`tsconfig.json` compiles everything under `src/` → `public/src/js/` (single config, `module: "none"`).

---

## Architecture

### ember-shared Bridge

`ember-shared` (`../ember-shared/`) is the platform-agnostic service library. `npm run build` automatically runs `build:shared` first. In tests, it is resolved directly to source via `moduleNameMapper`:

```
ember-shared → ../ember-shared/src/index
```

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

`public/index.html` has a single `<script defer src="src/js/utils/main-loader.js">`. At `DOMContentLoaded`, `main-loader` fetches all HTML fragments in parallel, assembles the DOM, then loads scripts **sequentially** in dependency order:

```
logger.js → app-state.js → voice-service.js → websocket-service.js →
message-service.js → channel-manager.js → ember-manager.js →
invite-manager.js → voice-ui-manager.js → renderer.js
```

HTML fragments live in `public/src/html/*.html` (one per UI section/modal).
CSS files live in `public/src/css/` — one file per concern (`settings.css`, `voice.css`, etc.).

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

| Test type | Location | Import depth |
|-----------|----------|--------------|
| Unit — managers | `tests/unit/managers/` | `../../../src/...` |
| Unit — services/utils | `tests/unit/services/`, `tests/unit/utils/` | `../../../src/...` |
| Integration | `tests/integration/` | `../../src/...` |

- Crypto and integration tests require `@jest-environment node` (for SubtleCrypto).
- IIFE module tests: set up `window.App`, `window.electronAPI`, `window.emberLog` mocks in `beforeAll`, then `require()` the module.

---

## Code Style

- **Naming**: PascalCase classes, camelCase functions/variables, kebab-case filenames
- **Functions**: start with a verb; `isX`/`hasX`/`canX` for booleans; `executeX`/`saveX` for void actions; <20 instructions
- **Classes**: <200 instructions, <10 public methods; prefer composition
- **Types**: always declare; no `any`; `readonly` for immutable data; one export per file
- **DOM**: no `innerHTML` — use `createElement`, `textContent`, `replaceChildren`
- **Never log**: tokens, private keys, ember keys, recovery codes, message content, invite codes, SDP/ICE data, or WebSocket URLs containing tokens
