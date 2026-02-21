# Snorlax Mode

Remote control Claude Code from your phone. Start a task on your laptop, walk away, and monitor progress from anywhere.

```
Phone (Browser)                    Laptop (Node.js)
┌──────────────┐                  ┌──────────────────┐
│  xterm.js    │◄──── output ────│  node-pty         │
│  Status Bar  │◄── status-update│  ├── claude CLI    │
│  Buttons     │──── input ─────►│  ├── parser.js     │
│  Input Field │                  │  └── notifier.js ──┼──► ntfy.sh
└──────────────┘                  └──────────────────┘
       ▲                                   │
       └── Socket.IO (WebSocket) ──────────┘
              via tunnel
```

## Features

- **Mobile terminal** -- full xterm.js terminal rendered on your phone
- **Real-time cost monitoring** -- session cost, token counts, and context window usage
- **Push notifications** -- get notified via [ntfy.sh](https://ntfy.sh) when Claude needs input
- **Quick action buttons** -- Yes/No/Cancel and command shortcuts (/cost, /status, /compact, /clear)
- **Auto-reconnect** -- scrollback buffer replays recent history on reconnect
- **Token-based auth** -- generated auth token prevents unauthorized access
- **Tunnel support** -- Cloudflare Tunnel (preferred) or localtunnel with QR code for easy phone connection
- **Auto-restart** -- claude CLI restarts automatically if it exits
- **Cross-platform** -- works on Windows, macOS, and Linux

## Prerequisites

- **Node.js** >= 18.0.0
- **Claude Code CLI** installed and on your PATH (`claude --version`)
- **Native build tools** (required by `node-pty`):
  - **Windows:** Visual Studio Build Tools or `npm install --global windows-build-tools`
  - **macOS:** `xcode-select --install`
  - **Linux:** `sudo apt install build-essential python3`

## Quick Start

```bash
git clone https://github.com/wilsoncheng/snorlax-mode.git
cd snorlax-mode
npm install
npm start
```

Scan the QR code printed in your terminal with your phone. Done.

## Global Install

```bash
npm install -g .

# Then run from any project directory:
cd /path/to/your/project
snorlax
```

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `SNORLAX_PORT` | `3000` | HTTP server port |
| `SNORLAX_NTFY_TOPIC` | `my-snorlax-alerts` | ntfy.sh topic for push notifications |
| `SNORLAX_NO_TUNNEL` | `0` | Set to `1` to disable tunnel (local network only) |
| `SNORLAX_SCROLLBACK` | `50000` | Max scrollback buffer size in characters |
| `SNORLAX_CLAUDE_CMD` | `claude` / `claude.cmd` | Override the claude CLI command |

```bash
# Example: custom port + notifications topic
SNORLAX_PORT=4000 SNORLAX_NTFY_TOPIC=my-alerts snorlax
```

## Push Notifications

1. Install the [ntfy app](https://ntfy.sh) on your phone
2. Subscribe to your topic (default: `my-snorlax-alerts`)
3. Set a unique topic for privacy: `SNORLAX_NTFY_TOPIC=my-secret-topic-abc123 snorlax`

Notifications fire when Claude is waiting for input or finishes generating. A 1.5s debounce prevents false positives during streaming.

## Network Access

**Cloudflare Tunnel** (preferred, no password page): Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), and Snorlax will use it automatically.

**localtunnel** (fallback): Used when cloudflared is not available. May show a password page -- enter your public IP.

**Local network only**: `SNORLAX_NO_TUNNEL=1 snorlax`, then open `http://<laptop-ip>:3000` from your phone.

## Tests

```bash
npm test                    # All tests
npm run test:unit           # Parser + notifier
npm run test:integration    # Socket.IO ↔ PTY bridge
npm run test:system         # File structure + config
npm run test:coverage       # With coverage report
```

## Security

- Tunnel URLs are public -- treat them like temporary passwords
- Token-based auth is enforced on all endpoints (except `/health`)
- ntfy.sh topics are public -- use a unique, hard-to-guess name
- Don't share the tunnel URL or QR code with untrusted parties

## License

MIT
