'use strict';

const http = require('http');
const path = require('path');
const { execFile, spawn } = require('child_process');
const fs = require('fs');

// =============================================================================
// System Tests – Verify the full application lifecycle
// =============================================================================

describe('System: Package structure', () => {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  let pkg;

  beforeAll(() => {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  });

  test('package.json has correct name', () => {
    expect(pkg.name).toBe('claude-remote');
  });

  test('package.json has bin entry for claude-remote', () => {
    expect(pkg.bin).toHaveProperty('claude-remote');
    expect(pkg.bin['claude-remote']).toBe('./server.js');
  });

  test('package.json has all required dependencies', () => {
    const requiredDeps = ['express', 'socket.io', 'node-pty', 'localtunnel', 'qrcode-terminal', 'selfsigned'];
    for (const dep of requiredDeps) {
      expect(dep in pkg.dependencies).toBe(true);
    }
  });

  test('package.json has test scripts', () => {
    expect(pkg.scripts).toHaveProperty('test');
    expect(pkg.scripts).toHaveProperty('test:unit');
    expect(pkg.scripts).toHaveProperty('test:integration');
    expect(pkg.scripts).toHaveProperty('test:system');
  });

  test('server.js has shebang line', () => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    const content = fs.readFileSync(serverPath, 'utf-8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });
});

describe('System: File structure', () => {
  const root = path.join(__dirname, '..');

  test('server.js exists', () => {
    expect(fs.existsSync(path.join(root, 'server.js'))).toBe(true);
  });

  test('public/index.html exists', () => {
    expect(fs.existsSync(path.join(root, 'public', 'index.html'))).toBe(true);
  });

  test('lib/parser.js exists', () => {
    expect(fs.existsSync(path.join(root, 'lib', 'parser.js'))).toBe(true);
  });

  test('lib/notifier.js exists', () => {
    expect(fs.existsSync(path.join(root, 'lib', 'notifier.js'))).toBe(true);
  });

  test('lib/ssl.js exists', () => {
    expect(fs.existsSync(path.join(root, 'lib', 'ssl.js'))).toBe(true);
  });

  test('shortcuts.json exists', () => {
    expect(fs.existsSync(path.join(root, 'shortcuts.json'))).toBe(true);
  });

  test('Dockerfile exists', () => {
    expect(fs.existsSync(path.join(root, 'Dockerfile'))).toBe(true);
  });

  test('docker-compose.yml exists', () => {
    expect(fs.existsSync(path.join(root, 'docker-compose.yml'))).toBe(true);
  });

  test('.dockerignore exists', () => {
    expect(fs.existsSync(path.join(root, '.dockerignore'))).toBe(true);
  });

  test('CLAUDE.md exists', () => {
    expect(fs.existsSync(path.join(root, 'CLAUDE.md'))).toBe(true);
  });

  test('DEPLOYMENT.md exists', () => {
    expect(fs.existsSync(path.join(root, 'DEPLOYMENT.md'))).toBe(true);
  });
});

describe('System: Module loading', () => {
  test('lib/parser.js exports all expected functions', () => {
    const parser = require('../lib/parser');
    expect(typeof parser.stripAnsi).toBe('function');
    expect(typeof parser.isPromptWaiting).toBe('function');
    expect(typeof parser.isGenerationComplete).toBe('function');
    expect(typeof parser.parseCostData).toBe('function');
    expect(typeof parser.OutputAccumulator).toBe('function');
  });

  test('lib/notifier.js exports Notifier class', () => {
    const { Notifier } = require('../lib/notifier');
    expect(typeof Notifier).toBe('function');
    const n = new Notifier({ fetchFn: jest.fn() });
    expect(n).toBeInstanceOf(Notifier);
    n.destroy();
  });

  test('lib/ssl.js exports getOrCreateCerts', () => {
    const ssl = require('../lib/ssl');
    expect(typeof ssl.getOrCreateCerts).toBe('function');
  });

  test('shortcuts.json is valid JSON array', () => {
    const shortcuts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'shortcuts.json'), 'utf-8'));
    expect(Array.isArray(shortcuts)).toBe(true);
    expect(shortcuts.length).toBeGreaterThan(0);
    // Each shortcut has label, key, title
    shortcuts.forEach(sc => {
      expect(sc).toHaveProperty('label');
      expect(sc).toHaveProperty('key');
      expect(sc).toHaveProperty('title');
    });
  });
});

describe('System: index.html content', () => {
  let html;

  beforeAll(() => {
    html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');
  });

  test('includes Tailwind CSS CDN', () => {
    expect(html).toContain('cdn.tailwindcss.com');
  });

  test('includes xterm.js', () => {
    expect(html).toContain('xterm');
  });

  test('includes socket.io client', () => {
    expect(html).toContain('socket.io');
  });

  test('has terminal container', () => {
    expect(html).toContain('id="terminal-container"');
  });

  test('has status bar', () => {
    expect(html).toContain('id="status-bar"');
  });

  test('has control panel', () => {
    expect(html).toContain('id="control-panel"');
  });

  test('has dynamic shortcuts grid', () => {
    expect(html).toContain('id="shortcuts-grid"');
    expect(html).toContain('/api/shortcuts');
  });

  test('has notification toggle', () => {
    expect(html).toContain('id="notify-toggle"');
    expect(html).toContain('Notification');
  });

  test('has text input for prompts', () => {
    expect(html).toContain('id="cmd-input"');
    expect(html).toContain('id="cmd-form"');
  });

  test('has inline status bar with cost/tokens/context', () => {
    expect(html).toContain('id="val-cost"');
    expect(html).toContain('id="val-tokens-in"');
    expect(html).toContain('id="val-tokens-out"');
    expect(html).toContain('id="val-context"');
  });

  test('has connection status indicators', () => {
    expect(html).toContain('id="conn-dot"');
    expect(html).toContain('id="conn-text"');
  });

  test('extracts auth token from URL', () => {
    expect(html).toContain('token');
    expect(html).toContain('auth');
  });
});

describe('System: server.js content', () => {
  let serverContent;

  beforeAll(() => {
    serverContent = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8');
  });

  test('enables CLAUDE_CODE_ENABLE_TELEMETRY', () => {
    expect(serverContent).toContain("CLAUDE_CODE_ENABLE_TELEMETRY: '1'");
  });

  test('creates health endpoint', () => {
    expect(serverContent).toContain("'/health'");
  });

  test('handles graceful shutdown', () => {
    expect(serverContent).toContain('SIGINT');
    expect(serverContent).toContain('SIGTERM');
  });

  test('uses lib/parser module', () => {
    expect(serverContent).toContain("require('./lib/parser')");
  });

  test('uses lib/notifier module', () => {
    expect(serverContent).toContain("require('./lib/notifier')");
  });

  test('configures scrollback buffer', () => {
    expect(serverContent).toContain('scrollbackBuffer');
    expect(serverContent).toContain('SCROLLBACK_LIMIT');
  });

  test('exports for testing', () => {
    expect(serverContent).toContain('module.exports');
  });

  test('implements token-based authentication', () => {
    expect(serverContent).toContain('AUTH_TOKEN');
    expect(serverContent).toContain('crypto.randomBytes');
  });

  test('supports cloudflared tunnel', () => {
    expect(serverContent).toContain('cloudflared');
  });

  test('supports HTTPS with self-signed certs', () => {
    expect(serverContent).toContain('CLAUDE_REMOTE_HTTPS');
    expect(serverContent).toContain('getOrCreateCerts');
    expect(serverContent).toContain('https.createServer');
  });

  test('has /api/shortcuts endpoint', () => {
    expect(serverContent).toContain('/api/shortcuts');
    expect(serverContent).toContain('shortcuts.json');
  });

  test('parses cost data from output', () => {
    expect(serverContent).toContain('accumulator');
    expect(serverContent).toContain('status-update');
  });

  test('removes CLAUDECODE env to prevent nesting error', () => {
    expect(serverContent).toContain('delete ptyEnv.CLAUDECODE');
  });
});

describe('System: Environment variable configuration', () => {
  test('CLAUDE_REMOTE_PORT is respected', () => {
    // Verify the config code exists in server.js
    const content = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8');
    expect(content).toContain('CLAUDE_REMOTE_PORT');
  });

  test('CLAUDE_REMOTE_NTFY_TOPIC is configurable', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8');
    expect(content).toContain('CLAUDE_REMOTE_NTFY_TOPIC');
  });

  test('CLAUDE_REMOTE_NO_TUNNEL is configurable', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8');
    expect(content).toContain('CLAUDE_REMOTE_NO_TUNNEL');
  });

  test('CLAUDE_REMOTE_CMD is configurable', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8');
    expect(content).toContain('CLAUDE_REMOTE_CMD');
  });

  test('CLAUDE_REMOTE_HTTPS is configurable', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8');
    expect(content).toContain('CLAUDE_REMOTE_HTTPS');
  });
});
