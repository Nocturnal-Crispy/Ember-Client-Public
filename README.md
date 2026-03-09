# Ember Client

A secure, cross-platform desktop chat application with end-to-end encryption, real-time messaging, and voice/video capabilities built on Electron and TypeScript.

------------------------------------------------------------------------

## 🚀 Features

-   **End-to-End Encryption** - NaCl-based encryption with per-ember symmetric keys
-   **Real-Time Messaging** - WebSocket-powered instant messaging with live updates
-   **Voice & Video Calls** - Built-in WebRTC communication with configurable devices
-   **Device Recovery** - 16-digit numeric recovery codes for secure device restoration
-   **Cross-Platform Support** - Native builds for Linux, Windows, and macOS
-   **Modern UI** - Responsive interface with customizable themes and settings
-   **Invite System** - Custom `ember://` protocol links for easy server invites
-   **Secure Storage** - OS-level encryption for sensitive data using system keyring

------------------------------------------------------------------------

## 🎯 Who This Is For

-   Privacy-focused individuals and teams
-   Organizations requiring secure internal communication
-   Developers wanting full control over their chat infrastructure
-   Homelab users running self-hosted Ember servers
-   Communities needing encrypted real-time collaboration

------------------------------------------------------------------------

## 🖥 Requirements

-   **Node.js** 18.0+ (20.0+ recommended)
-   **npm** 9.0+ or **yarn** 1.22+
-   **Operating System**: Windows 10+, macOS 10.15+, or modern Linux distribution
-   **Memory**: 4GB RAM minimum (8GB recommended)
-   **Storage**: 500MB available space for application and dependencies
-   **Network**: Internet connection for server communication

------------------------------------------------------------------------

## ⚡ Quick Start

```bash
# Clone the repository
git clone https://github.com/Nocturnal-Crispy/Ember-Client-Public.git
cd ember-client

# Install dependencies
npm install

# Build the application
npm run build

# Launch Ember
npm start
```

First launch will open the login window. Connect to your Ember server and start chatting!

------------------------------------------------------------------------

## ⚙️ Configuration

### Environment Setup

Ember client automatically detects and connects to Ember servers. Key configuration options:

-   **Server Hostname**: Set during login or via `ember://invite/` links
-   **Device Settings**: Voice/video devices, push-to-talk keys
-   **Theme Preferences**: Customizable appearance and behavior
-   **Security Settings**: Recovery code management and key storage

### Environment Variables

<!-- AUTO-GENERATED from codebase analysis -->

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Set to 'development' for debug mode and developer tools | `production` |

<!-- END AUTO-GENERATED -->

### Data Storage

-   **Linux**: `~/.config/ember-client/`
-   **macOS**: `~/Library/Application Support/ember-client/`
-   **Windows**: `%APPDATA%\ember-client\`

All sensitive data is encrypted using the operating system's secure storage.

------------------------------------------------------------------------

## 🧱 Architecture

High-level overview:

```
Electron Main Process
├── Window Management
├── IPC Handlers
├── Security (safeStorage)
└── Protocol Handlers
        ↓
Electron Renderer Process
├── UI Components (HTML/CSS)
├── Service Layer
│   ├── Auth Service
│   ├── Message Service
│   ├── Voice Service
│   └── WebSocket Service
├── Manager Layer
│   ├── App State Manager
│   ├── Channel Manager
│   ├── Ember Manager
│   └── Voice UI Manager
└── Crypto Service (NaCl)
        ↓
Ember Server (WebSocket/HTTP)
```

**Key Components:**

-   **Main Process** (`src/main/`) - Window lifecycle, IPC, security
-   **Renderer Process** (`src/renderer/`) - UI logic, services, managers
-   **Crypto Service** - End-to-end encryption using NaCl
-   **WebSocket Service** - Real-time communication with server
-   **Voice Service** - WebRTC-based voice/video communication

------------------------------------------------------------------------

## 🏗 Developer Architecture Reference

### Source vs. Compiled Files

<!-- AUTO-GENERATED from tsconfig.main.json + tsconfig.renderer.json -->

**Always edit TypeScript source files, never compiled output:**

| Source (edit these) | Compiled output (auto-generated) |
|---------------------|----------------------------------|
| `src/main/**/*.ts` | `dist/main/**/*.js` |
| `src/preload/**/*.ts` | `dist/preload/**/*.js` |
| `src/renderer/**/*.ts` | `dist/renderer/**/*.js` |
| `src/shared/**/*.ts` | `dist/shared/**/*.js` |

<!-- END AUTO-GENERATED -->

### Script Load Order (index.html)

```
logger.js → app-state.js → voice-service.js → websocket-service.js →
message-service.js → channel-manager.js → ember-manager.js →
invite-manager.js → voice-ui-manager.js → renderer.js
```

### Renderer Module Pattern (IIFE)

Non-module `<script>` tags share the global lexical scope. All split-out modules **must** be wrapped in an IIFE to prevent `SyntaxError: Identifier already declared`:

```javascript
(function () {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger('ModuleName');
  // ... functions ...
  window.myExportedFunc = myExportedFunc;  // explicit export
})();
```

`renderer.js` stays as a plain top-level script (not IIFE); its `function` declarations auto-become globals.

### ember-shared Bridge

Platform-agnostic service logic lives in `ember-shared/`. The preload exposes it via `contextBridge`:

```typescript
// In renderer (no Node.js access):
window.electronAPI.authService.login(payload)
window.electronAPI.channelService.fetchChannels(authData, emberId)
window.electronAPI.wsService.buildWsUrl(hostname, token)
```

Build automatically rebuilds `ember-shared` before compiling TypeScript (`build:shared && tsc`).

### Structural Notes

<!-- AUTO-GENERATED from codebase analysis -->

These files exceed the project's <200-instruction guideline and are candidates for future extraction:

| File | Lines |
|------|-------|
| `src/renderer/managers/direct-messaging-ui.ts` | 1,619 |
| `src/renderer/managers/voice-ui-manager.ts` | 1,227 |
| `src/renderer/services/message-service.ts` | 970 |
| `src/renderer/managers/ember-manager.ts` | 938 |
| `src/renderer/managers/direct-messaging-manager.ts` | 921 |
| `src/renderer/managers/channel-manager.ts` | 870 |
| `src/renderer/services/voice-service.ts` | 792 |
| `src/renderer/managers/renderer.ts` | 762 |
| `src/renderer/managers/dm-accessibility-enhancer.ts` | 731 |

<!-- END AUTO-GENERATED -->

------------------------------------------------------------------------

## 📦 Build & Distribution

<!-- AUTO-GENERATED from package.json scripts -->

### Development Builds

```bash
# Development build with hot reload
npm run build && npm start

# Run tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage report
npm test -- --coverage

# Build for current platform
npm run dist
```

### Platform-Specific Builds

```bash
# Linux (AppImage + deb)
npm run dist:linux

# Windows (Installer + Portable)
npm run dist:win

# macOS (DMG + ZIP)
npm run dist:mac
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `build` | Build TypeScript and copy assets to dist/ |
| `build:shared` | Build ember-shared dependency |
| `start` | Build and launch the application |
| `dev` | Development build with NODE_ENV=development |
| `dev:watch` | Development build with NODE_ENV=development + launch |
| `dist` | Build and create distributable packages |
| `dist:linux` | Build for Linux (AppImage + deb) |
| `dist:win` | Build for Windows (Installer + Portable) |
| `dist:mac` | Build for macOS (DMG + ZIP) |
| `test` | Run Jest test suite |
| `release` | Build and execute release script |

<!-- END AUTO-GENERATED -->

### Automated Release

Use the included release script for automated version bumping and GitHub releases:

```bash
./scripts/release.sh
```

This script:
-   Runs tests
-   Bumps version
-   Builds for all platforms
-   Creates GitHub release
-   Commits version changes

------------------------------------------------------------------------

## � Downloads

### Official Releases

Download pre-built binaries from **[GitHub Releases](https://github.com/Nocturnal-Crispy/Ember-Client-Public/releases)**:

-   **Windows Portable**: `Ember-Portable.exe` (~76 MB)
-   **Windows Installer**: `EmberSetup.exe` (~77 MB)  
-   **Linux AppImage**: `Ember.AppImage` (~105 MB)
-   **Linux Debian**: `Ember.deb` (~73 MB)

### Web Download

Alternatively, download the application directly from **[ember-chat.com](https://ember-chat.com/)**

### Verification

All releases include SHA256 checksums for verification:

```bash
# Example verification
sha256sum Ember-Portable.exe
# Expected: 03297205bbb3918d704e56599b26663279ff918654470b25b11147932e7ab248
```

------------------------------------------------------------------------

## � Updating

### For Users

Download the latest version from **[GitHub Releases](https://github.com/Nocturnal-Crispy/Ember-Client-Public/releases)** or **[ember-chat.com](https://ember-chat.com/)** and install over your existing version.

### For Developers

```bash
git pull main
npm install
npm run build
npm start
```

------------------------------------------------------------------------

## 💾 Backup & Recovery

### Device Backup

Ember automatically generates a **16-digit recovery code** during registration:

```
XXXX-XXXX-XXXX-XXXX
```

**Important:** Save this code securely! It's required to:
-   Restore your device on new installations
-   Recover access after data loss
-   Migrate between devices

### Manual Backup

To backup your complete Ember data:

```bash
# Linux
cp -r ~/.config/ember-client ~/ember-backup

# macOS
cp -r ~/Library/Application\ Support/ember-client ~/ember-backup

# Windows
xcopy "%APPDATA%\ember-client" "%USERPROFILE%\ember-backup" /E /I
```

------------------------------------------------------------------------

## 🛡 Security Notes

-   **End-to-End Encryption**: All messages encrypted with NaCl before transmission
-   **Zero-Knowledge**: Server cannot access message content
-   **Secure Key Storage**: Private keys encrypted with OS keyring
-   **Recovery Security**: Recovery codes use PBKDF2 key derivation
-   **Protocol Validation**: `ember://` links validated to prevent injection
-   **No Telemetry**: Ember does not collect user data or analytics

------------------------------------------------------------------------

## 🔍 Troubleshooting

Common issues and solutions:

**Connection Issues**
-   Verify server hostname and port
-   Check network connectivity
-   Confirm server is running and accessible

**Authentication Problems**
-   Ensure correct server URL
-   Verify login credentials
-   Check if account exists on server

**Voice/Video Issues**
-   Grant microphone/camera permissions
-   Configure correct input/output devices
-   Check WebRTC compatibility

**Build Issues**
-   Clear node_modules: `rm -rf node_modules && npm install`
-   Check Node.js version compatibility
-   Verify system dependencies

**Performance Issues**
-   Close unused applications
-   Check available memory
-   Restart Ember client

------------------------------------------------------------------------

## 🧪 Development Setup

### Prerequisites

```bash
# Install Node.js (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### Development Workflow

<!-- AUTO-GENERATED from package.json scripts -->

```bash
# Clone repository
git clone https://github.com/Nocturnal-Crispy/Ember-Client-Public.git
cd ember-client

# Install dependencies
npm install

# Development mode (with file watching)
npm run build && npm start

# Run tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage

# Type checking
npm run build

# Linting (if configured)
npm run lint
```

<!-- END AUTO-GENERATED -->

### Debug Mode

To enable developer tools:

1. Open `src/main.ts`
2. Change `devTools: false` to `devTools: true` in webPreferences
3. Rebuild and restart

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage
```

------------------------------------------------------------------------

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

1.  **Fork** the repository
2.  Create a **feature branch**: `git checkout -b feature/amazing-feature`
3.  **Commit** your changes: `git commit -m 'Add amazing feature'`
4.  **Push** to the branch: `git push origin feature/amazing-feature`
5.  Open a **Pull Request**

### Code Style Guidelines

-   Follow TypeScript best practices
-   Use JSDoc comments for public functions
-   Maintain existing code structure
-   Add tests for new features
-   Ensure all tests pass before PR

### Development Areas

-   **UI/UX improvements** in CSS and HTML
-   **Service enhancements** in TypeScript
-   **Security improvements** in crypto implementation
-   **Voice/video features** and WebRTC integration
-   **Cross-platform compatibility** fixes

------------------------------------------------------------------------

## 🗺 Roadmap

-   **v0.1**: Core messaging and encryption ✅
-   **v0.2**: Voice/video communication ✅
-   **v0.3**: Advanced UI features and themes
-   **v0.4**: Plugin system and extensions
-   **v0.5**: Mobile companion app
-   **v1.0**: Stable release with full feature set

------------------------------------------------------------------------

## 📜 License

**Commercial License** - Copyright (c) Michael Crispen

This software is commercial software and requires a paid license for use. 

**Prohibited without license:**
- Use, copy, modify, or distribute this software
- Commercial or personal use
- Redistribution in any form

All rights reserved. No permission is granted without explicit commercial license.

------------------------------------------------------------------------

## 🔗 Links

-   **GitHub Repository**: [Nocturnal-Crispy/Ember-Client-Public](https://github.com/Nocturnal-Crispy/Ember-Client-Public)
-   **Server Repository**: [Nocturnal-Crispy/Ember-Server-Public](https://github.com/Nocturnal-Crispy/Ember-Server-Public)
-   **Issues & Bug Reports**: [GitHub Issues](https://github.com/Nocturnal-Crispy/Ember-Client-Public/issues)
-   **Discussions & Community**: [GitHub Discussions](https://github.com/Nocturnal-Crispy/Ember-Client-Public/discussions)

------------------------------------------------------------------------

**Built with ❤️ for secure, private communication**
