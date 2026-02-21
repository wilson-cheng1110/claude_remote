'use strict';

const {
  stripAnsi,
  isPromptWaiting,
  isGenerationComplete,
  parseCostData,
  OutputAccumulator,
} = require('../lib/parser');

const { Notifier, DEFAULT_TOPIC, DEFAULT_DEBOUNCE_MS } = require('../lib/notifier');

// =============================================================================
// Parser – stripAnsi
// =============================================================================
describe('stripAnsi', () => {
  test('removes basic color codes', () => {
    expect(stripAnsi('\x1b[32mGreen\x1b[0m')).toBe('Green');
  });

  test('removes cursor movement codes', () => {
    expect(stripAnsi('\x1b[2J\x1b[HHello')).toBe('Hello');
  });

  test('handles text with no ANSI codes', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });

  test('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  test('removes multiple chained codes', () => {
    const input = '\x1b[1m\x1b[31mBold Red\x1b[0m Normal';
    expect(stripAnsi(input)).toBe('Bold Red Normal');
  });

  test('removes 256-color codes', () => {
    expect(stripAnsi('\x1b[38;5;196mRed\x1b[0m')).toBe('Red');
  });
});

// =============================================================================
// Parser – isPromptWaiting
// =============================================================================
describe('isPromptWaiting', () => {
  test('detects (Y/n) prompt', () => {
    expect(isPromptWaiting('Overwrite file? (Y/n) ')).toBe(true);
  });

  test('detects [y/N] prompt', () => {
    expect(isPromptWaiting('Are you sure? [y/N] ')).toBe(true);
  });

  test('detects (yes/no) prompt', () => {
    expect(isPromptWaiting('Proceed with changes? (yes/no) ')).toBe(true);
  });

  test('detects Claude TUI selector (❯ 1. Yes)', () => {
    expect(isPromptWaiting('❯ 1. Yes')).toBe(true);
  });

  test('detects "Yes and don\'t ask again" option', () => {
    expect(isPromptWaiting('  2. Yes, and don\'t ask again for grep:*')).toBe(true);
  });

  test('returns false for normal output', () => {
    expect(isPromptWaiting('Processing files...')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isPromptWaiting('')).toBe(false);
  });

  test('returns false for normal question in output', () => {
    expect(isPromptWaiting('What should we do next?')).toBe(false);
  });

  test('handles ANSI-wrapped prompts', () => {
    expect(isPromptWaiting('\x1b[32m(Y/n) \x1b[0m')).toBe(true);
  });
});

// =============================================================================
// Parser – isGenerationComplete
// =============================================================================
describe('isGenerationComplete', () => {
  test('detects "Total cost:" line', () => {
    expect(isGenerationComplete('Total cost: $1.23')).toBe(true);
  });

  test('detects "Session cost:" line', () => {
    expect(isGenerationComplete('Session cost: $0.45')).toBe(true);
  });

  test('returns false for normal output', () => {
    expect(isGenerationComplete('Writing code...')).toBe(false);
  });

  test('returns false for horizontal rules (UI chrome)', () => {
    expect(isGenerationComplete('───────────────────')).toBe(false);
  });
});

// =============================================================================
// Parser – parseCostData
// =============================================================================
describe('parseCostData', () => {
  test('parses session cost', () => {
    const result = parseCostData('Session cost: $1.23');
    expect(result).toEqual({ sessionCost: '1.23' });
  });

  test('parses total cost', () => {
    const result = parseCostData('Total cost: $45.67');
    expect(result).toEqual({ totalCost: '45.67' });
  });

  test('parses total tokens', () => {
    const result = parseCostData('Total tokens: 12,345');
    expect(result).toEqual({ totalTokens: '12,345' });
  });

  test('parses input and output tokens', () => {
    const result = parseCostData('Input tokens: 5,000\nOutput tokens: 3,200');
    expect(result).toEqual({ inputTokens: '5,000', outputTokens: '3,200' });
  });

  test('parses context window usage', () => {
    const result = parseCostData('Context window: 65% used');
    expect(result).toEqual({ contextWindow: '65% used', contextUsedAlt: '65' });
  });

  test('parses "used X%" format from Claude output', () => {
    const result = parseCostData('Context window: 127,453 / 200,000 tokens (used 63.7%)');
    expect(result.contextUsed).toBe('63.7');
  });

  test('parses percentage of context', () => {
    const result = parseCostData('42% of context');
    expect(result).toEqual({ contextUsedAlt: '42' });
  });

  test('parses cache read tokens', () => {
    const result = parseCostData('Cache read tokens: 8,000');
    expect(result).toEqual({ cacheRead: '8,000' });
  });

  test('returns null for unparseable data', () => {
    expect(parseCostData('Hello world')).toBeNull();
  });

  test('handles ANSI codes in cost output', () => {
    const result = parseCostData('\x1b[33mSession cost: $2.50\x1b[0m');
    expect(result).toEqual({ sessionCost: '2.50' });
  });

  test('parses multiple fields from combined output', () => {
    const output = `Session cost: $3.21
Total tokens: 50,000
Context window: 78% used`;
    const result = parseCostData(output);
    expect(result.sessionCost).toBe('3.21');
    expect(result.totalTokens).toBe('50,000');
    expect(result.contextWindow).toBe('78% used');
    expect(result.contextUsedAlt).toBe('78');
  });

  test('parses tokens with k suffix', () => {
    const result = parseCostData('Input tokens: 45k\nOutput tokens: 12k');
    expect(result).toEqual({ inputTokens: '45k', outputTokens: '12k' });
  });
});

// =============================================================================
// Parser – OutputAccumulator
// =============================================================================
describe('OutputAccumulator', () => {
  let acc;

  beforeEach(() => {
    acc = new OutputAccumulator();
  });

  test('returns null for non-cost data', () => {
    expect(acc.append('regular output')).toBeNull();
  });

  test('returns cost data when detected', () => {
    const result = acc.append('Session cost: $1.00');
    expect(result).toEqual({ costData: { sessionCost: '1.00' } });
  });

  test('merges cost data across multiple appends', () => {
    acc.append('Session cost: $1.00');
    const result = acc.append('Total tokens: 5,000');
    expect(result.costData).toEqual({ sessionCost: '1.00', totalTokens: '5,000' });
  });

  test('getLastCostData returns accumulated data', () => {
    acc.append('Session cost: $2.00');
    acc.append('regular output');
    expect(acc.getLastCostData()).toEqual({ sessionCost: '2.00' });
  });

  test('reset clears all data', () => {
    acc.append('Session cost: $2.00');
    acc.reset();
    expect(acc.getLastCostData()).toBeNull();
  });

  test('trims buffer when exceeding max size', () => {
    acc.maxBufferSize = 100;
    const longData = 'x'.repeat(200);
    acc.append(longData);
    expect(acc.buffer.length).toBe(100);
  });
});

// =============================================================================
// Notifier – Construction & Configuration
// =============================================================================
describe('Notifier', () => {
  test('disables itself when no topic provided', () => {
    const n = new Notifier({ fetchFn: jest.fn() });
    expect(n.topic).toBeNull();
    expect(n._enabled).toBe(false);
  });

  test('uses custom topic from options', () => {
    const n = new Notifier({ topic: 'custom-topic', fetchFn: jest.fn() });
    expect(n.topic).toBe('custom-topic');
  });

  test('uses default debounce time', () => {
    const n = new Notifier({ fetchFn: jest.fn() });
    expect(n.debounceMs).toBe(DEFAULT_DEBOUNCE_MS);
  });

  test('constructs correct URL', () => {
    const n = new Notifier({ topic: 'test-topic', fetchFn: jest.fn() });
    expect(n.url).toBe('https://ntfy.sh/test-topic');
  });
});

// =============================================================================
// Notifier – sendImmediate
// =============================================================================
describe('Notifier.sendImmediate', () => {
  let mockFetch;
  let notifier;

  beforeEach(() => {
    mockFetch = jest.fn().mockResolvedValue({ ok: true });
    notifier = new Notifier({
      topic: 'test',
      fetchFn: mockFetch,
      logger: jest.fn(),
      errorLogger: jest.fn(),
    });
  });

  test('sends POST to ntfy.sh', async () => {
    await notifier.sendImmediate('Title', 'Body');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://ntfy.sh/test',
      expect.objectContaining({
        method: 'POST',
        body: 'Body',
        headers: expect.objectContaining({ Title: 'Title' }),
      })
    );
  });

  test('returns sent:true on success', async () => {
    const result = await notifier.sendImmediate('Title', 'Body');
    expect(result).toEqual({ sent: true });
  });

  test('returns sent:false when disabled', async () => {
    notifier.setEnabled(false);
    const result = await notifier.sendImmediate('Title', 'Body');
    expect(result).toEqual({ sent: false, reason: 'disabled' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('returns sent:false on HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, statusText: 'Bad Request' });
    const result = await notifier.sendImmediate('Title', 'Body');
    expect(result).toEqual({ sent: false, reason: 'Bad Request' });
  });

  test('returns sent:false on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network down'));
    const result = await notifier.sendImmediate('Title', 'Body');
    expect(result).toEqual({ sent: false, reason: 'Network down' });
  });

  test('passes custom priority and tags', async () => {
    await notifier.sendImmediate('Title', 'Body', 'high', 'warning');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Priority: 'high', Tags: 'warning' }),
      })
    );
  });
});

// =============================================================================
// Notifier – Debounced scheduling
// =============================================================================
describe('Notifier.scheduleNotification', () => {
  let mockFetch;
  let notifier;

  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch = jest.fn().mockResolvedValue({ ok: true });
    notifier = new Notifier({
      topic: 'test',
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

  test('does not send immediately', () => {
    notifier.scheduleNotification('Title', 'Body');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(notifier.isPending()).toBe(true);
  });

  test('sends after debounce period', () => {
    notifier.scheduleNotification('Title', 'Body');
    jest.advanceTimersByTime(500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('cancels pending notification', () => {
    notifier.scheduleNotification('Title', 'Body');
    notifier.cancelPending();
    jest.advanceTimersByTime(1000);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(notifier.isPending()).toBe(false);
  });

  test('resets debounce on repeated schedule calls', () => {
    notifier.scheduleNotification('Title', 'Body');
    jest.advanceTimersByTime(300);
    notifier.scheduleNotification('Title2', 'Body2');
    jest.advanceTimersByTime(300);
    expect(mockFetch).not.toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('does not schedule when disabled', () => {
    notifier.setEnabled(false);
    notifier.scheduleNotification('Title', 'Body');
    expect(notifier.isPending()).toBe(false);
  });

  test('destroy cancels pending', () => {
    notifier.scheduleNotification('Title', 'Body');
    notifier.destroy();
    jest.advanceTimersByTime(1000);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
