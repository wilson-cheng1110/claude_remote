#!/usr/bin/env node
'use strict';

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server: SocketIO } = require('socket.io');
const pty = require('node-pty');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn: cpSpawn } = require('child_process');

const { stripAnsi, isPromptWaiting, isGenerationComplete, parseCostData, OutputAccumulator } = require('./lib/parser');
const { Notifier } = require('./lib/notifier');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PREFERRED_PORT = parseInt(process.env.CLAUDE_REMOTE_PORT || process.env.PORT || '3000', 10);
const SCROLLBACK_LIMIT = parseInt(process.env.CLAUDE_REMOTE_SCROLLBACK || '50000', 10);
const DISABLE_TUNNEL = process.env.CLAUDE_REMOTE_NO_TUNNEL === '1';
const CLAUDE_CMD = process.env.CLAUDE_REMOTE_CMD ||
  (os.platform() === 'win32' ? 'claude.cmd' : 'claude');
const AUTH_TOKEN = process.env.CLAUDE_REMOTE_TOKEN || crypto.randomBytes(16).toString('hex');
const READONLY = process.argv.includes('--readonly');

// ntfy topic: env var > persisted file > generate new random one
function resolveNtfyTopic() {
  if (process.env.CLAUDE_REMOTE_NTFY_TOPIC) return process.env.CLAUDE_REMOTE_NTFY_TOPIC;
  const topicFile = path.join(__dirname, '.ntfy-topic');
  try {
    const saved = fs.readFileSync(topicFile, 'utf-8').trim();
    if (saved) return saved;
  } catch {}
  const generated = 'cr-' + crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(topicFile, generated, 'utf-8');
  return generated;
}
const NTFY_TOPIC = resolveNtfyTopic();

// ---------------------------------------------------------------------------
// Express + Socket.IO setup
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ---------------------------------------------------------------------------
// Auth middleware – token must be in ?token= query param
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  // Allow health check without auth
  if (req.path === '/health') return next();
  // Allow socket.io (handled separately)
  if (req.path.startsWith('/socket.io')) return next();

  const token = req.query.token;
  if (token !== AUTH_TOKEN) {
    return res.status(403).send(`
      <html><body style="background:#111;color:#fff;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh">
        <div style="text-align:center">
          <h1>403 – Access Denied</h1>
          <p>Invalid or missing token. Scan the QR code to get the correct URL.</p>
        </div>
      </body></html>
    `);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint (no auth required)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    ptyAlive: ptyProcess && !ptyProcess.killed,
    clients: io.engine ? io.engine.clientsCount : 0,
  });
});

// ---------------------------------------------------------------------------
// Socket.IO auth – validate token on connection
// ---------------------------------------------------------------------------
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (token === AUTH_TOKEN) {
    return next();
  }
  next(new Error('Authentication failed'));
});

// ---------------------------------------------------------------------------
// PTY Process – spawn claude with telemetry enabled, auto-restart on exit
// ---------------------------------------------------------------------------
const ptyEnv = {
  ...process.env,
  CLAUDE_CODE_ENABLE_TELEMETRY: '1',
  TERM: 'xterm-256color',
};
// Remove nesting guard so claude CLI can launch from within a Claude Code session
delete ptyEnv.CLAUDECODE;

let ptyProcess;
let scrollbackBuffer = '';
let lastOutputTime = Date.now();
let lastUserInputTime = Date.now();
let waitingForInput = false;
let shuttingDown = false;

const notifier = new Notifier({ topic: NTFY_TOPIC });
const accumulator = new OutputAccumulator();

function appendToScrollback(data) {
  scrollbackBuffer += data;
  if (scrollbackBuffer.length > SCROLLBACK_LIMIT) {
    scrollbackBuffer = scrollbackBuffer.slice(-SCROLLBACK_LIMIT);
  }
}

function spawnPty() {
  try {
    ptyProcess = pty.spawn(CLAUDE_CMD, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: ptyEnv,
    });
    console.log(`[claude-remote] PTY spawned (pid=${ptyProcess.pid}) running: ${CLAUDE_CMD}`);
  } catch (err) {
    console.error(`[claude-remote] Failed to spawn PTY: ${err.message}`);
    console.error('[claude-remote] Make sure "claude" CLI is installed and on your PATH.');
    process.exit(1);
  }

  // Wire up PTY output
  ptyProcess.onData((data) => {
    lastOutputTime = Date.now();
    io.emit('output', data);
    appendToScrollback(data);

    const parsed = accumulator.append(data);
    if (parsed && parsed.costData) {
      io.emit('status-update', parsed.costData);
    }

    // Only run prompt detection on chunks with substantial text content.
    // Skip cursor moves, ANSI redraws, and tiny fragments.
    const clean = stripAnsi(data).trim();
    if (clean.length > 5) {
      if (isPromptWaiting(data)) {
        waitingForInput = true;
        notifier.scheduleNotification(
          'Claude is waiting for input',
          'Your Claude Code session needs your attention.'
        );
      } else if (isGenerationComplete(data)) {
        waitingForInput = true;
        notifier.scheduleNotification(
          'Claude finished generating',
          'Generation complete. Check the output.'
        );
      } else if (clean.length > 30) {
        waitingForInput = false;
        notifier.cancelPending();
      }
    }
  });

  // Auto-restart claude when it exits
  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`[claude-remote] PTY exited (code=${exitCode}, signal=${signal})`);
    io.emit('pty-exit', { exitCode, signal });

    if (shuttingDown) return;

    // Clear scrollback and restart after a short delay
    console.log('[claude-remote] Auto-restarting claude in 2 seconds...');
    scrollbackBuffer = '';
    accumulator.reset();
    setTimeout(() => {
      if (!shuttingDown) {
        io.emit('output', '\r\n\x1b[33m--- Restarting Claude... ---\x1b[0m\r\n');
        spawnPty();
      }
    }, 2000);
  });
}

// Initial spawn
spawnPty();

// ---------------------------------------------------------------------------
// Socket.IO connection handling
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`[claude-remote] Client connected (id=${socket.id})`);

  // Send scrollback buffer so the client sees recent history
  if (scrollbackBuffer.length > 0) {
    socket.emit('output', scrollbackBuffer);
  }

  // Send last known cost data
  const lastCost = accumulator.getLastCostData();
  if (lastCost) {
    socket.emit('status-update', lastCost);
  }

  // Pipe user input from socket to pty (blocked in readonly mode)
  socket.on('input', (data) => {
    if (READONLY) {
      socket.emit('output', '\r\n\x1b[31m--- Read-only mode: input disabled ---\x1b[0m\r\n');
      return;
    }
    lastUserInputTime = Date.now();
    waitingForInput = false;
    notifier.cancelPending();
    if (ptyProcess && !ptyProcess.killed) {
      ptyProcess.write(data);
    }
  });

  // Handle terminal resize
  socket.on('resize', (size) => {
    if (size && size.cols && size.rows && ptyProcess && !ptyProcess.killed) {
      try {
        ptyProcess.resize(Math.max(1, size.cols), Math.max(1, size.rows));
      } catch (e) {
        // Resize can fail if pty is closing
      }
    }
  });

  // Client requests a cost refresh
  socket.on('request-status', () => {
    const lastCost = accumulator.getLastCostData();
    if (lastCost) {
      socket.emit('status-update', lastCost);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[claude-remote] Client disconnected (id=${socket.id})`);
  });
});

// ---------------------------------------------------------------------------
// Tunnel helpers
// ---------------------------------------------------------------------------
function findCloudflared() {
  // Check PATH first
  try {
    execSync(os.platform() === 'win32' ? 'where cloudflared' : 'which cloudflared', { stdio: 'ignore' });
    return 'cloudflared';
  } catch {}

  // Check common winget install location on Windows
  if (os.platform() === 'win32') {
    const glob = require('path');
    const wingetBase = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
    try {
      const dirs = fs.readdirSync(wingetBase).filter(d => d.toLowerCase().includes('cloudflare'));
      for (const dir of dirs) {
        const exe = path.join(wingetBase, dir, 'cloudflared.exe');
        if (fs.existsSync(exe)) return exe;
      }
    } catch {}
  }

  return null;
}

async function startCloudflaredTunnel(port) {
  const bin = findCloudflared();
  if (!bin) throw new Error('cloudflared not found');

  return new Promise((resolve, reject) => {
    const proc = cpSpawn(bin, ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let resolved = false;
    const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

    const onData = (chunk) => {
      const text = chunk.toString();
      const match = text.match(urlRegex);
      if (match && !resolved) {
        resolved = true;
        resolve({ url: match[0], process: proc, type: 'cloudflared' });
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => { if (!resolved) reject(err); });
    setTimeout(() => { if (!resolved) reject(new Error('cloudflared timeout')); }, 20000);
  });
}

async function startLocaltunnel(port) {
  const localtunnel = require('localtunnel');
  const tunnel = await localtunnel({ port });
  return { url: tunnel.url, tunnel, type: 'localtunnel' };
}

async function startTunnel(port) {
  // Try cloudflared first (no password page, more reliable)
  const cfBin = findCloudflared();
  if (cfBin) {
    console.log(`[claude-remote] Found cloudflared at: ${cfBin}`);
    console.log('[claude-remote] Starting Cloudflare Tunnel (no password page)...');
    try {
      return await startCloudflaredTunnel(port);
    } catch (err) {
      console.log(`[claude-remote] cloudflared failed: ${err.message}, falling back to localtunnel...`);
    }
  } else {
    console.log('[claude-remote] cloudflared not found, using localtunnel (may show password page)');
  }

  // Fallback to localtunnel
  return await startLocaltunnel(port);
}

// ---------------------------------------------------------------------------
// Start server – try preferred port, auto-select if busy
// ---------------------------------------------------------------------------
async function startServer(port) {
  const actualPort = await new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[claude-remote] Port ${port} in use, finding an available port...`);
        server.listen(0, () => resolve(server.address().port));
      } else {
        reject(err);
      }
    });
    server.listen(port, () => resolve(port));
  });

  console.log(`[claude-remote] Server listening on http://localhost:${actualPort}`);
  console.log(`[claude-remote] Auth token: ${AUTH_TOKEN}`);
  console.log(`[claude-remote] Telemetry: CLAUDE_CODE_ENABLE_TELEMETRY=1`);
  console.log(`[claude-remote] Notifications: ntfy.sh/${NTFY_TOPIC}`);
  if (READONLY) console.log(`[claude-remote] READ-ONLY mode — input disabled`);

  if (DISABLE_TUNNEL) {
    const localUrl = `http://localhost:${actualPort}?token=${AUTH_TOKEN}`;
    console.log(`[claude-remote] Tunnel disabled. Local URL: ${localUrl}`);
    qrcode.generate(localUrl, { small: true }, (qr) => { console.log(qr); });
    return;
  }

  try {
    const tunnelResult = await startTunnel(actualPort);
    const tunnelUrl = `${tunnelResult.url}?token=${AUTH_TOKEN}`;

    // Write tunnel URL to file
    fs.writeFileSync(path.join(__dirname, '.tunnel-url'), tunnelUrl, 'utf-8');

    console.log('\n\x1b[36m=========================================\x1b[0m');
    console.log(`\x1b[33m  CLAUDE REMOTE ACTIVE\x1b[0m`);
    console.log(`\x1b[36m=========================================\x1b[0m`);
    console.log(`\x1b[90m  Tunnel: ${tunnelResult.type}\x1b[0m`);
    console.log(`\x1b[32m  URL: ${tunnelUrl}\x1b[0m`);
    console.log(`\x1b[36m-----------------------------------------\x1b[0m`);
    console.log('  Scan QR code on your phone:\n');

    qrcode.generate(tunnelUrl, { small: true }, (qr) => {
      console.log(qr);
    });

    console.log('\x1b[36m=========================================\x1b[0m\n');

    if (tunnelResult.type === 'localtunnel') {
      // Fetch public IP so we can show it for the password page
      try {
        const ipRes = await fetch('https://ipv4.icanhazip.com');
        const ip = (await ipRes.text()).trim();
        console.log(`\x1b[33m  If localtunnel asks for a password, enter: ${ip}\x1b[0m\n`);
      } catch {}

      tunnelResult.tunnel.on('close', () => console.log('[claude-remote] Tunnel closed'));
      tunnelResult.tunnel.on('error', (err) => console.error('[claude-remote] Tunnel error:', err.message));
    }
  } catch (err) {
    console.error('[claude-remote] Failed to create tunnel:', err.message);
    const localUrl = `http://localhost:${actualPort}?token=${AUTH_TOKEN}`;
    console.log(`[claude-remote] Access locally: ${localUrl}`);
  }
}

startServer(PREFERRED_PORT);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
  console.log(`\n[claude-remote] Received ${signal}, shutting down...`);
  shuttingDown = true;
  notifier.destroy();
  if (ptyProcess && !ptyProcess.killed) {
    ptyProcess.kill();
  }

  // Clean up runtime files (keep .ntfy-topic for persistence)
  try { fs.unlinkSync(path.join(__dirname, '.tunnel-url')); } catch {}

  server.close(() => {
    console.log('[claude-remote] Server closed.');
    process.exit(0);
  });

  setTimeout(() => {
    console.log('[claude-remote] Forcing exit.');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------
module.exports = {
  app,
  server,
  io,
  ptyProcess,
  notifier,
  accumulator,
  scrollbackBuffer: () => scrollbackBuffer,
  appendToScrollback,
  shutdown,
  PREFERRED_PORT,
  AUTH_TOKEN,
};
