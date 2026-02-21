# Claude Remote – Deployment Guide

## Prerequisites

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0
- **Claude Code CLI** installed and on your PATH (`claude --version` should work)
- **Python + C++ build tools** (required by `node-pty` native addon):
  - **Windows:** `npm install --global windows-build-tools` or install Visual Studio Build Tools
  - **macOS:** `xcode-select --install`
  - **Linux:** `sudo apt install build-essential python3`

## Quick Start (Local)

```bash
# 1. Clone the project
git clone <repository-url>
cd claude_claude-remote

# 2. Install dependencies
npm install

# 3. Start Claude Remote
npm start
```

The server will:
1. Spawn a `claude` CLI process with telemetry enabled
2. Start an Express server on port 3000
3. Create a localtunnel and print a QR code
4. Scan the QR code on your phone to open the mobile UI

## Global Installation

Install globally to use `claude-remote` as a CLI command from any directory:

```bash
# From the project directory
npm install -g .

# Now you can run from any project directory
cd /path/to/your/project
claude-remote
```

Or install directly from a registry (when published):

```bash
npm install -g claude-remote
```

## Configuration

All configuration is via environment variables. Set them before running:

```bash
# Custom port
CLAUDE_REMOTE_PORT=8080 claude-remote

# Custom ntfy.sh topic (for your own push notifications)
CLAUDE_REMOTE_NTFY_TOPIC=my-private-alerts claude-remote

# Disable localtunnel (local network only)
CLAUDE_REMOTE_NO_TUNNEL=1 claude-remote

# Custom claude command path
CLAUDE_REMOTE_CMD=/usr/local/bin/claude claude-remote

# Larger scrollback buffer
CLAUDE_REMOTE_SCROLLBACK=100000 claude-remote

# Combine multiple options
CLAUDE_REMOTE_PORT=4000 CLAUDE_REMOTE_NTFY_TOPIC=team-alerts claude-remote
```

On Windows (PowerShell):
```powershell
$env:CLAUDE_REMOTE_PORT = "8080"
$env:CLAUDE_REMOTE_NTFY_TOPIC = "my-alerts"
node server.js
```

## Push Notifications Setup

Claude Remote sends push notifications via [ntfy.sh](https://ntfy.sh) when Claude needs input.

1. Install the **ntfy** app on your phone ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [iOS](https://apps.apple.com/app/ntfy/id1625396347))
2. Subscribe to your topic (default: `my-claude-remote-alerts`)
3. Set a custom topic for privacy:
   ```bash
   CLAUDE_REMOTE_NTFY_TOPIC=my-secret-topic-abc123 claude-remote
   ```

## Network Access

### localtunnel (Default)

By default, Claude Remote uses localtunnel to expose your local server to the internet. The URL is printed in the terminal and displayed as a QR code.

**Note:** localtunnel URLs are public. Anyone with the URL can access your terminal. Use a custom ntfy topic and don't share the URL.

### Local Network Only

If you're on the same WiFi as your phone:

```bash
CLAUDE_REMOTE_NO_TUNNEL=1 claude-remote
```

Then access `http://<your-laptop-ip>:3000` from your phone.

Find your local IP:
- **macOS/Linux:** `ifconfig | grep inet`
- **Windows:** `ipconfig`

### ngrok (Alternative)

If localtunnel is unreliable, use ngrok instead:

```bash
CLAUDE_REMOTE_NO_TUNNEL=1 claude-remote &
ngrok http 3000
```

## Running Tests

```bash
# Install dev dependencies
npm install

# Run all tests
npm test

# Run specific test suites
npm run test:unit          # Parser and notifier unit tests
npm run test:integration   # Socket.IO ↔ PTY bridge tests
npm run test:system        # Structure and configuration tests

# With coverage
npm run test:coverage
```

## Troubleshooting

### `claude` command not found

Make sure Claude Code CLI is installed:
```bash
npm install -g @anthropic-ai/claude-code
```

Verify it's on your PATH:
```bash
claude --version
```

### node-pty fails to install

`node-pty` requires native compilation. Ensure build tools are installed:

```bash
# Windows
npm install --global windows-build-tools

# macOS
xcode-select --install

# Ubuntu/Debian
sudo apt install build-essential python3

# Then reinstall
rm -rf node_modules
npm install
```

### localtunnel connection issues

localtunnel can be flaky. Options:
1. Retry: `npm start` (it will get a new URL)
2. Use local network: `CLAUDE_REMOTE_NO_TUNNEL=1 claude-remote`
3. Use ngrok as an alternative

### Mobile UI doesn't load

- Ensure your phone can reach the URL (try opening it in a browser)
- If using local network, ensure both devices are on the same WiFi
- Check that no firewall is blocking the port

### Terminal looks garbled on mobile

- Try rotating your phone to landscape mode
- The terminal auto-fits on resize
- Use the `/clear` button to reset the display

### Push notifications not arriving

1. Verify ntfy app is installed and subscribed to the correct topic
2. Check server logs for `[ntfy] Alert sent to <topic>` messages
3. Test manually: `curl -d "test" ntfy.sh/my-claude-remote-alerts`
4. Ensure your phone has internet access

## Architecture Overview

```
Phone (Browser)                    Laptop (Node.js)
┌──────────────┐                  ┌──────────────────┐
│  xterm.js    │◄──── output ────│  node-pty         │
│  Status Bar  │◄── status-update│  ├── claude CLI    │
│  Buttons     │──── input ─────►│  │   (with TELEMETRY=1)
│  Input Field │                  │  ├── parser.js     │
└──────────────┘                  │  └── notifier.js ──┼──► ntfy.sh
       ▲                          └──────────────────┘
       │                                   │
       └── Socket.IO (WebSocket) ──────────┘
              via localtunnel
```

## Security Considerations

- **localtunnel URLs are public** – treat them like temporary passwords
- **No authentication built in** – anyone with the URL has full terminal access
- **ntfy.sh topics are public** – use a unique, hard-to-guess topic name
- **Don't share** the tunnel URL or QR code with untrusted parties
- For production use, consider adding authentication middleware to Express
