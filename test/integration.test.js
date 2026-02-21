'use strict';

const http = require('http');
const express = require('express');
const { Server: SocketIO } = require('socket.io');
const ioClient = require('socket.io-client');
const path = require('path');
const EventEmitter = require('events');

const { OutputAccumulator } = require('../lib/parser');
const { Notifier } = require('../lib/notifier');

// =============================================================================
// Mock PTY – simulates node-pty for integration testing
// =============================================================================
class MockPty extends EventEmitter {
  constructor() {
    super();
    this.written = [];
    this.killed = false;
    this.pid = 12345;
    this.cols = 80;
    this.rows = 30;
  }

  write(data) {
    this.written.push(data);
  }

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
  }

  kill() {
    this.killed = true;
  }

  // Simulate data output
  simulateData(data) {
    this.emit('data', data);
  }

  // Simulate exit
  simulateExit(exitCode = 0) {
    this.emit('exit', { exitCode, signal: 0 });
  }

  // node-pty compatible API
  onData(cb) {
    this.on('data', cb);
    return { dispose: () => this.removeListener('data', cb) };
  }

  onExit(cb) {
    this.on('exit', cb);
    return { dispose: () => this.removeListener('exit', cb) };
  }
}

// =============================================================================
// Helper: Create a test server that mimics the real server behavior
// =============================================================================
function createTestServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIO(server, { cors: { origin: '*' } });
  const ptyMock = new MockPty();
  const accumulator = new OutputAccumulator();
  const notifier = new Notifier({
    topic: 'test-topic',
    fetchFn: jest.fn().mockResolvedValue({ ok: true }),
    logger: jest.fn(),
    errorLogger: jest.fn(),
  });

  let scrollbackBuffer = '';

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ptyAlive: !ptyMock.killed, clients: io.engine.clientsCount });
  });

  // Wire up pty output → socket clients
  ptyMock.onData((data) => {
    io.emit('output', data);
    scrollbackBuffer += data;

    const parsed = accumulator.append(data);
    if (parsed && parsed.costData) {
      io.emit('status-update', parsed.costData);
    }
  });

  ptyMock.onExit(({ exitCode, signal }) => {
    io.emit('pty-exit', { exitCode, signal });
  });

  // Wire up socket clients → pty input
  io.on('connection', (socket) => {
    if (scrollbackBuffer.length > 0) {
      socket.emit('output', scrollbackBuffer);
    }

    const lastCost = accumulator.getLastCostData();
    if (lastCost) {
      socket.emit('status-update', lastCost);
    }

    socket.on('input', (data) => {
      if (!ptyMock.killed) ptyMock.write(data);
    });

    socket.on('resize', (size) => {
      if (size && size.cols && size.rows && !ptyMock.killed) {
        ptyMock.resize(size.cols, size.rows);
      }
    });

    socket.on('request-status', () => {
      const lastCost = accumulator.getLastCostData();
      if (lastCost) socket.emit('status-update', lastCost);
    });
  });

  return { app, server, io, ptyMock, accumulator, notifier, getScrollback: () => scrollbackBuffer };
}

// =============================================================================
// Integration Tests
// =============================================================================
describe('Integration: Server ↔ Client communication', () => {
  let testServer;
  let client;
  let port;

  beforeEach((done) => {
    testServer = createTestServer();
    testServer.server.listen(0, () => {
      port = testServer.server.address().port;
      client = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
      });
      client.on('connect', done);
    });
  });

  afterEach((done) => {
    if (client) client.disconnect();
    testServer.io.close();
    testServer.server.close(done);
  });

  // ── PTY output → Client ──
  test('client receives PTY output', (done) => {
    client.on('output', (data) => {
      // May receive scrollback first, then the simulated data
      if (data.includes('Hello from Claude')) {
        done();
      }
    });
    testServer.ptyMock.simulateData('Hello from Claude');
  });

  test('client receives ANSI-colored output intact', (done) => {
    const ansiData = '\x1b[32mGreen text\x1b[0m';
    client.on('output', (data) => {
      if (data.includes('\x1b[32m')) {
        expect(data).toContain(ansiData);
        done();
      }
    });
    testServer.ptyMock.simulateData(ansiData);
  });

  // ── Client input → PTY ──
  test('client input is forwarded to PTY', (done) => {
    // Small delay to ensure connection is fully established
    setTimeout(() => {
      client.emit('input', 'test command\r');
      setTimeout(() => {
        expect(testServer.ptyMock.written).toContain('test command\r');
        done();
      }, 100);
    }, 50);
  });

  test('Ctrl+C is forwarded to PTY', (done) => {
    setTimeout(() => {
      client.emit('input', '\x03');
      setTimeout(() => {
        expect(testServer.ptyMock.written).toContain('\x03');
        done();
      }, 100);
    }, 50);
  });

  // ── Resize ──
  test('client resize event resizes PTY', (done) => {
    setTimeout(() => {
      client.emit('resize', { cols: 120, rows: 40 });
      setTimeout(() => {
        expect(testServer.ptyMock.cols).toBe(120);
        expect(testServer.ptyMock.rows).toBe(40);
        done();
      }, 100);
    }, 50);
  });

  test('invalid resize data is ignored', (done) => {
    setTimeout(() => {
      client.emit('resize', { cols: null, rows: null });
      setTimeout(() => {
        // Should remain at original size
        expect(testServer.ptyMock.cols).toBe(80);
        expect(testServer.ptyMock.rows).toBe(30);
        done();
      }, 100);
    }, 50);
  });

  // ── Scrollback buffer ──
  test('new client receives scrollback buffer', (done) => {
    // Generate some output first
    testServer.ptyMock.simulateData('Previous output line 1\n');
    testServer.ptyMock.simulateData('Previous output line 2\n');

    // Connect a second client
    setTimeout(() => {
      const client2 = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
      });

      client2.on('output', (data) => {
        if (data.includes('Previous output line 1') && data.includes('Previous output line 2')) {
          client2.disconnect();
          done();
        }
      });
    }, 200);
  });

  // ── Status updates ──
  test('cost data is parsed and emitted as status-update', (done) => {
    client.on('status-update', (data) => {
      expect(data.sessionCost).toBe('2.50');
      done();
    });
    testServer.ptyMock.simulateData('Session cost: $2.50');
  });

  test('request-status returns last known cost data', (done) => {
    testServer.ptyMock.simulateData('Session cost: $1.00');

    setTimeout(() => {
      client.on('status-update', (data) => {
        if (data.sessionCost === '1.00') {
          done();
        }
      });
      client.emit('request-status');
    }, 200);
  });

  // ── PTY exit ──
  test('client receives pty-exit event', (done) => {
    client.on('pty-exit', (data) => {
      expect(data.exitCode).toBe(0);
      done();
    });
    testServer.ptyMock.simulateExit(0);
  });
});

// =============================================================================
// Integration: Health endpoint
// =============================================================================
describe('Integration: HTTP endpoints', () => {
  let testServer;
  let port;

  beforeEach((done) => {
    testServer = createTestServer();
    testServer.server.listen(0, () => {
      port = testServer.server.address().port;
      done();
    });
  });

  afterEach((done) => {
    testServer.io.close();
    testServer.server.close(done);
  });

  test('GET /health returns status JSON', (done) => {
    http.get(`http://localhost:${port}/health`, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        const json = JSON.parse(body);
        expect(json.status).toBe('ok');
        expect(json.ptyAlive).toBe(true);
        done();
      });
    });
  });

  test('GET / serves index.html', (done) => {
    http.get(`http://localhost:${port}/`, (res) => {
      expect(res.statusCode).toBe(200);
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        expect(body).toContain('Claude Remote');
        done();
      });
    });
  });
});

// =============================================================================
// Integration: Notifier with mock fetch
// =============================================================================
describe('Integration: Notifier with prompt detection', () => {
  const { isPromptWaiting, isGenerationComplete } = require('../lib/parser');

  let mockFetch;
  let notifier;

  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch = jest.fn().mockResolvedValue({ ok: true });
    notifier = new Notifier({
      topic: 'integration-test',
      debounceMs: 500,
      fetchFn: mockFetch,
      logger: jest.fn(),
      errorLogger: jest.fn(),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    notifier.destroy();
  });

  test('prompt detection triggers debounced notification', () => {
    const data = 'Are you sure? (Y/n) ';
    if (isPromptWaiting(data)) {
      notifier.scheduleNotification('Input needed', 'Claude is waiting');
    }
    expect(notifier.isPending()).toBe(true);
    jest.advanceTimersByTime(500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('subsequent output cancels pending notification', () => {
    const promptData = '> ';
    if (isPromptWaiting(promptData)) {
      notifier.scheduleNotification('Input needed', 'Claude is waiting');
    }

    // More output arrives before debounce fires
    const moreOutput = 'Processing files...';
    if (!isPromptWaiting(moreOutput) && !isGenerationComplete(moreOutput)) {
      notifier.cancelPending();
    }

    jest.advanceTimersByTime(1000);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('generation complete triggers notification', () => {
    const data = 'Total cost: $3.50';
    if (isGenerationComplete(data)) {
      notifier.scheduleNotification('Generation complete', 'Check output');
    }
    jest.advanceTimersByTime(500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
