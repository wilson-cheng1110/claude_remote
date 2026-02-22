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
│  ├── HTTPS (self-signed certs via lib/ssl.js)           │
│  ├── Token auth (random 16-byte hex per session)        │
│  ├── Cloudflare Tunnel (preferred) or localtunnel       │
│  └── qrcode-terminal (prints connection QR code)        │
│                                                         │
│  lib/parser.js   – ANSI strip, prompt detect, cost parse│
│  lib/notifier.js – ntfy.sh + browser push notifications │
│  lib/ssl.js      – Self-signed cert generation/caching  │
│  shortcuts.json  – Configurable shortcut buttons        │
└───────────────────────┬─────────────────────────────────┘
                        │ WebSocket (Socket.IO)
                        ▼
┌─────────────────────────────────────────────────────────┐
│  PHONE (Mobile Web App)                                 │
│                                                         │
│  public/index.html                                      │
│  ├── xterm.js (terminal display, fills available space) │
│  ├── Status bar (cost/tokens-in/tokens-out/context)     │
│  ├── Shortcut buttons (↑/↓/Tab/Enter/Esc/Y/N)          │
│  ├── Notification bell toggle (browser notifications)   │
│  └── Text input for custom prompts                      │
└─────────────────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|---|---|
| `server.js` | Main entry point. Express + Socket.IO + node-pty + tunneling + HTTPS + auth. |
| `lib/parser.js` | Pure functions: ANSI stripping, prompt detection, cost/token parsing, `OutputAccumulator`. |
| `lib/notifier.js` | `Notifier` class for debounced ntfy.sh + browser push notifications. |
| `lib/ssl.js` | Self-signed certificate generation and caching (`.ssl/` directory). |
| `shortcuts.json` | Configurable shortcut button definitions loaded by the client via `/api/shortcuts`. |
| `public/index.html` | Single-page mobile web UI with xterm.js + Tailwind CSS. |
| `qr.js` | Standalone utility to re-print the QR code from `.tunnel-url`. |
| `test/unit.test.js` | Unit tests for parser and notifier modules. |
| `test/integration.test.js` | Socket.IO ↔ PTY bridge integration tests. |
| `test/system.test.js` | Full system structure and configuration tests. |
| `Dockerfile` | Container image (node:20-bookworm, production deps only). |
| `docker-compose.yml` | Dev-ready compose config with HTTPS and persistent SSL certs. |
| `.dockerignore` | Excludes secrets, node_modules, .git from Docker builds. |

## Development Commands

```bash
npm install          # Install dependencies
npm start            # Start the server (spawns claude CLI)
npm run qr           # Re-print the QR code from .tunnel-url
npm test             # Run all tests
npm run test:unit    # Unit tests only
npm run test:integration  # Integration tests only
npm run test:system  # System tests only
npm run test:coverage     # Tests with coverage report
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_REMOTE_PORT` | `3000` | HTTP/HTTPS server port |
| `CLAUDE_REMOTE_NTFY_TOPIC` | Auto-generated (`cr-{random}`), persisted to `.ntfy-topic` | ntfy.sh topic for push notifications |
| `CLAUDE_REMOTE_NO_TUNNEL` | `0` | Set to `1` to disable tunneling |
| `CLAUDE_REMOTE_SCROLLBACK` | `50000` | Max scrollback buffer size in characters |
| `CLAUDE_REMOTE_CMD` | `claude` / `claude.cmd` | Override the claude CLI command |
| `CLAUDE_REMOTE_HTTPS` | `1` (enabled) | Set to `0` to disable self-signed HTTPS |
| `CLAUDE_REMOTE_TOKEN` | Auto-generated (random 16-byte hex) | Override the auth token |

## CLI Flags

| Flag | Description |
|---|---|
| `--readonly` | Disable all user input to the PTY (monitor-only mode) |

## Conventions

- **No TypeScript** – plain Node.js CommonJS modules for zero build step.
- **Single HTML file** – the entire client is one `public/index.html` using CDN dependencies.
- **Testable modules** – `lib/parser.js` and `lib/notifier.js` are pure/injectable, no side effects at import.
- **server.js exports** – the server exports `app`, `server`, `io`, `ptyProcess`, `notifier`, `accumulator`, etc. for test access.
- **Notifications are debounced** – 3s default in `Notifier`, used by `server.js` on prompt/generation-complete detection.
- **Telemetry is always on** – `CLAUDE_CODE_ENABLE_TELEMETRY=1` is set in the PTY environment.
- **Cross-platform** – Windows (`cmd.exe`, `claude.cmd`) and Unix (`bash`, `claude`) are both supported.
- **HTTPS by default** – Self-signed certs are auto-generated and cached in `.ssl/`.
- **Token auth** – All HTTP and Socket.IO requests require `?token=` or `auth.token`.

## How Authentication Works

1. On startup, a random 16-byte hex token is generated (or read from `CLAUDE_REMOTE_TOKEN`).
2. All HTTP routes (except `/health` and `/socket.io`) require `?token=` in the query string.
3. Socket.IO connections are validated via `auth.token` or `query.token` in the handshake.
4. The full URL (with token) is embedded in the QR code printed to the console.

## How Tunneling Works

1. If `CLAUDE_REMOTE_NO_TUNNEL=1`, only a local URL is generated.
2. Otherwise, `cloudflared` is searched for on PATH (and Windows WinGet locations).
3. If found, a Cloudflare quick tunnel is started (no password page, more reliable).
4. If `cloudflared` is not found or fails, localtunnel is used as a fallback.
5. The tunnel URL (with auth token) is written to `.tunnel-url` and printed as a QR code.

## How Push Notifications Work

Notifications are sent through two channels simultaneously:

**ntfy.sh** (phone push notifications):
1. `server.js` pipes all PTY stdout through `isPromptWaiting()` and `isGenerationComplete()`.
2. If a prompt is detected, `notifier.scheduleNotification()` starts a 3s debounce timer.
3. If more non-prompt output arrives before the timer fires, it's canceled (false alarm).
4. If the timer fires, a POST is sent to `https://ntfy.sh/{topic}`.
5. Subscribe on your phone: install the ntfy app and subscribe to your topic.

**Browser notifications** (via Socket.IO):
1. When the debounce timer fires, a `notify` event is also emitted to all connected clients.
2. If the browser tab is hidden, a native `Notification` is shown.
3. If the tab is focused, a subtle in-page toast appears instead.
4. The notification bell in the status bar toggles browser notifications on/off.

## How Cost Monitoring Works

1. `OutputAccumulator` in `lib/parser.js` watches the PTY stream for cost/token patterns.
2. When patterns like `Session cost: $X.XX` or `Total tokens: X,XXX` are detected, the data is emitted via Socket.IO `status-update` event.
3. The client also parses output independently as a redundant check (throttled at 500ms).
4. Cost data accumulates and merges (latest value wins per field).
5. New clients connecting receive the last known cost data immediately.

## How Shortcuts Work

1. `shortcuts.json` defines the button labels, key sequences, and tooltips.
2. The client fetches `/api/shortcuts?token=...` on load.
3. If the file is missing or the fetch fails, hardcoded defaults are used.
4. Buttons are rendered in a responsive grid with color-coded styles (blue=Tab, green=Enter, red=Esc).
