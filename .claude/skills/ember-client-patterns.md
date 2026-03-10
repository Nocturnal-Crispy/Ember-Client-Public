---
name: ember-client-patterns
description: Coding patterns extracted from ember-client git history (Electron + TypeScript desktop app)
version: 1.0.0
source: local-git-analysis
analyzed_commits: 200
---

# Ember Client Patterns

## Commit Conventions

This project uses a **mixed style** — prefer conventional commits for new work:

```
feat: add new feature
fix: correct a bug
docs: update documentation
refactor: restructure without behavior change
chore: maintenance (deps, build config)
style: CSS/visual-only changes
test: add or fix tests
```

**Version bumps** are always separate commits: `Bump version to 0.0.X`

The release script (`./scripts/release.sh`) handles: test → version bump → dist → GitHub release.

---

## Architecture

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # Window management, IPC handlers, protocol
│   ├── ipc/                 # IPC handler modules
│   ├── menus/               # Application menus
│   ├── services/            # Main-process services
│   └── windows/             # Window creation helpers
├── preload/
│   └── index.ts             # contextBridge — exposes window.electronAPI
├── renderer/
│   ├── managers/            # UI state managers (IIFE modules)
│   ├── services/            # Renderer-side services (IIFE modules)
│   ├── utils/               # Utilities (main-loader, logger, etc.)
│   ├── types/
│   │   └── globals.d.ts     # Global Window interface + domain type aliases
│   ├── assets/icons/        # App icons
│   ├── styles/
│   │   ├── base/            # reset.css, typography.css, variables.css
│   │   ├── components/      # One CSS file per UI component
│   │   ├── layout/          # channel-list, server-list, title-bar, user-panel
│   │   └── utilities/       # color-variables, colors, spacing, transitions
│   └── *.html               # HTML fragments (one per section/modal)
└── shared/
    ├── constants/index.ts   # App-wide constants
    └── types/index.ts       # Shared domain types
```

---

## Key Workflows

### Adding a New Renderer Module

1. Create `src/renderer/managers/my-feature.ts` as an **IIFE**:
   ```typescript
   (function (): void {
     const log = window.emberLog.createLogger('MyFeature');
     // ... implementation ...
     window.myFeatureFunc = myFeatureFunc; // export to global
   })();
   ```
2. Add HTML fragment: `src/renderer/my-feature.html`
3. Add CSS: `src/renderer/styles/components/my-feature.css`
4. Register in `src/renderer/utils/main-loader.ts` (both HTML and script, in dependency order)
5. Add global type in `src/renderer/types/globals.d.ts`
6. Write tests in `tests/unit/managers/my-feature.test.ts`

### Adding a New IPC Channel

When you add a new IPC channel, these files **always change together**:
- `src/preload/index.ts` — add to `ALLOWED_SEND`, `ALLOWED_INVOKE`, or `ALLOWED_ON`
- `src/main/index.ts` — add `ipcMain.handle(...)` or `ipcMain.on(...)` handler
- `src/renderer/types/globals.d.ts` — add method signature to `window.electronAPI`

### Adding a New UI Feature (with CSS)

When adding any UI with styling, expect co-changes in:
- `src/renderer/managers/[feature].ts` (or existing manager)
- `src/renderer/styles/components/[feature].css`
- `src/renderer/[feature].html` (if new modal/section)
- `src/renderer/types/globals.d.ts` (if new globals)
- `src/renderer/utils/main-loader.ts` (if new script/fragment)

---

## CSS Conventions

Files are organized by concern, **never a single monolithic CSS file**:

| Category | Location | Examples |
|----------|----------|---------|
| Base | `styles/base/` | `reset.css`, `typography.css`, `variables.css` |
| Components | `styles/components/` | `settings.css`, `voice.css`, `chat.css` |
| Layout | `styles/layout/` | `channel-list.css`, `server-list.css` |
| Utilities | `styles/utilities/` | `color-variables.css`, `spacing.css` |

CSS variable root is defined in `styles/base/variables.css` and `styles/utilities/color-variables.css`.

**Terminal/blocky aesthetic** is the current design language — squared edges, monospace fonts, blocky UI elements.

---

## IIFE Module Pattern

All renderer modules **except `renderer.ts`** use IIFEs to avoid `SyntaxError: Identifier already declared`:

```typescript
(function (): void {
  const log = window.emberLog.createLogger('ModuleName');

  function doThing(): void {
    // ...
  }

  window.doThing = doThing; // explicit export
})();
```

`renderer.ts` is a plain top-level script — its `function` declarations auto-become globals.

---

## Testing Patterns

- Tests live in `tests/unit/managers/` and `tests/unit/services/`
- File naming: `*.test.ts` (TypeScript) or `*.jest.test.js` (JS integration)
- Import depth from `tests/unit/managers/`: `../../../src/...`
- Import depth from `tests/integration/`: `../../src/...`
- Crypto/integration tests require `@jest-environment node`

**IIFE module tests** require window mock setup before `require()`:
```typescript
beforeAll(() => {
  (global as any).window = {
    App: { ... },
    electronAPI: { ... },
    emberLog: { createLogger: () => ({ info: jest.fn(), error: jest.fn() }) },
  };
  require('../../../src/renderer/managers/my-module');
});
```

**Most-tested files** (highest churn → most test coverage needed):
- `src/renderer/managers/channel-manager.ts`
- `src/renderer/services/websocket-service.ts`
- `src/renderer/managers/ember-manager.ts`

---

## Hot Files (Change Often — Handle with Care)

| File | Why It Changes |
|------|---------------|
| `src/renderer/types/globals.d.ts` | Every new global or IPC channel |
| `src/renderer/utils/main-loader.ts` | Every new module or HTML fragment |
| `src/preload/index.ts` | Every new IPC channel |
| `src/main/index.ts` | Every new IPC handler |
| `src/renderer/services/voice-service.ts` | Complex WebRTC logic — fragile |
| `src/renderer/managers/voice-ui-manager.ts` | Voice UI state — fragile |

---

## Release Workflow

```bash
./scripts/release.sh   # test → bump version → build dist → GitHub release
```

Manual steps if needed:
1. `npm test` — all 106 tests must pass
2. Update `package.json` version (semver: `0.0.X`)
3. `npm run dist:linux` / `dist:win` / `dist:mac`
4. Create GitHub release with artifacts
