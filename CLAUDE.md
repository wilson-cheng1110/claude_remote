# Claude Remote – Project Guide

## What This Is

Claude Remote is a two-part remote control wrapper (Node.js Host + Mobile Web Client) that lets you trigger Claude Code from your phone, walk away while it executes tasks on your laptop, and monitor token costs / system status remotely.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  LAPTOP (Node.js Host)                                  │
│                                                         │
│  server.js                                              │
│  ├── Express (serves public/index.html)                 │
│  ├── Socket.IO (real-time bidirectional I/O)            │
│  ├── node-pty (spawns persistent `claude` CLI process)  │
│  ├── localtunnel (exposes port to public internet)      │
│  └── qrcode-terminal (prints connection QR code)        │
│                                                         │
│  lib/parser.js   – ANSI strip, prompt detect, cost parse│
│  lib/notifier.js – ntfy.sh push notifications           │
└───────────────────────┬─────────────────────────────────┘
                        │ WebSocket (Socket.IO)
                        ▼
┌─────────────────────────────────────────────────────────┐
│  PHONE (Mobile Web App)                                 │
│                                                         │
│  public/index.html                                      │
│  ├── xterm.js (terminal display, top ~70%)              │
│  ├── Status bar (cost/tokens/context pills)             │
│  ├── Quick buttons (Yes/No/Cancel/1-5)                  │
│  ├── Command buttons (/cost, /status, /compact, /clear) │
│  └── Custom prompt input                                │
└─────────────────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|---|---|
| `server.js` | Main entry point. Express + Socket.IO + node-pty + localtunnel. |
| `lib/parser.js` | Pure functions: ANSI stripping, prompt detection, cost/token parsing. |
| `lib/notifier.js` | `Notifier` class for debounced ntfy.sh push notifications. |
| `public/index.html` | Single-page mobile web UI with xterm.js + Tailwind CSS. |
| `test/unit.test.js` | Unit tests for parser and notifier modules. |
| `test/integration.test.js` | Socket.IO ↔ PTY bridge integration tests. |
| `test/system.test.js` | Full system structure and configuration tests. |

## Development Commands

```bash
npm install          # Install dependencies
npm start            # Start the server (spawns claude CLI)
npm test             # Run all tests
npm run test:unit    # Unit tests only
npm run test:integration  # Integration tests only
npm run test:system  # System tests only
npm run test:coverage     # Tests with coverage report
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_REMOTE_PORT` | `3000` | HTTP server port |
| `CLAUDE_REMOTE_NTFY_TOPIC` | `my-claude-remote-alerts` | ntfy.sh topic for push notifications |
| `CLAUDE_REMOTE_NO_TUNNEL` | `0` | Set to `1` to disable localtunnel |
| `CLAUDE_REMOTE_SCROLLBACK` | `50000` | Max scrollback buffer size in characters |
| `CLAUDE_REMOTE_CMD` | `claude` / `claude.cmd` | Override the claude CLI command |

## Conventions

- **No TypeScript** – plain Node.js CommonJS modules for zero build step.
- **Single HTML file** – the entire client is one `public/index.html` using CDN dependencies.
- **Testable modules** – `lib/parser.js` and `lib/notifier.js` are pure/injectable, no side effects at import.
- **server.js exports** – the server exports `app`, `server`, `io`, etc. for test access.
- **Notifications are debounced** – 1.5s default delay to avoid false positives during streaming.
- **Telemetry is always on** – `CLAUDE_CODE_ENABLE_TELEMETRY=1` is set in the PTY environment.
- **Cross-platform** – Windows (`cmd.exe`, `claude.cmd`) and Unix (`bash`, `claude`) are both supported.

## How Push Notifications Work

1. `server.js` pipes all PTY stdout through `isPromptWaiting()` and `isGenerationComplete()`.
2. If a prompt is detected, `notifier.scheduleNotification()` starts a 1.5s debounce timer.
3. If more non-prompt output arrives before the timer fires, it's canceled (false alarm).
4. If the timer fires, a POST is sent to `https://ntfy.sh/{topic}`.
5. Subscribe on your phone: install the ntfy app and subscribe to your topic.

## How Cost Monitoring Works

1. `OutputAccumulator` in `lib/parser.js` watches the PTY stream for cost/token patterns.
2. When patterns like `Session cost: $X.XX` or `Total tokens: X,XXX` are detected, the data is emitted via Socket.IO `status-update` event.
3. The client also parses output independently as a redundant check.
4. Cost data accumulates and merges (latest value wins per field).
5. New clients connecting receive the last known cost data immediately.
