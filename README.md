# Ember GUI Application

A beautiful desktop application built with Electron and TypeScript.

## Features

- 🎨 Modern UI design
- 💬 Chat interface with message input
- 📱 Server and channel navigation
- 👥 Member list with online status
- ⚡ Built with Electron for cross-platform support
- 📝 TypeScript for type safety

## Prerequisites

- Node.js (v16 or higher)
- npm

## Installation

```bash
npm install
```

## Usage

### Run the application
```bash
npm run dev
```

Or build and start:
```bash
npm run build
npm start
```

## Project Structure

```
.
├── src/
│   └── main.ts        # Electron main process
├── public/
│   ├── index.html     # Main UI layout
│   ├── styles.css     # Styling
│   └── renderer.js    # Renderer process logic
├── dist/              # Compiled JavaScript output (generated)
├── package.json       # Project dependencies and scripts
├── tsconfig.json      # TypeScript configuration
└── README.md          # This file
```

## Features Walkthrough

- **Server List**: Navigate between different servers (left sidebar)
- **Channel List**: Browse text and voice channels
- **Chat Area**: Send and view messages in real-time
- **Member List**: See who's online in the server
- **Message Input**: Type messages and press Enter to send

## Tech Stack

- **Electron**: Desktop application framework
- **TypeScript**: Type-safe JavaScript
- **HTML/CSS**: Modern UI
