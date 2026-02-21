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
    const requiredDeps = ['express', 'socket.io', 'node-pty', 'localtunnel', 'qrcode-terminal'];
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

  test('has TUI navigation buttons', () => {
    expect(html).toContain('id="btn-up"');
    expect(html).toContain('id="btn-down"');
    expect(html).toContain('id="btn-tab"');
    expect(html).toContain('id="btn-enter"');
    expect(html).toContain('id="btn-esc"');
  });

  test('sends correct key sequences for TUI navigation', () => {
    expect(html).toContain("'\\x1b[A'");   // Arrow Up
    expect(html).toContain("'\\x1b[B'");   // Arrow Down
    expect(html).toContain("'\\t'");        // Tab
    expect(html).toContain("'\\r'");        // Enter
    expect(html).toContain("'\\x1b'");      // Escape
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
});
