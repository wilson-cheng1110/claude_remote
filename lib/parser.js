'use strict';

/**
 * Core parsing utilities for Claude Remote.
 * Handles ANSI stripping, prompt detection, and cost/context parsing.
 */

// Regex to strip ANSI escape codes from terminal output
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

/**
 * Strip ANSI escape codes from a string.
 */
function stripAnsi(str) {
  return str.replace(ANSI_REGEX, '');
}

// Patterns that indicate Claude Code is waiting for user input.
// IMPORTANT: Keep these conservative to avoid false positives.
// False positives cause cost polling to inject commands at the wrong time.
const PROMPT_PATTERNS = [
  /\(Y\/n\)\s*$/i,                       // Yes/No confirmation
  /\(y\/N\)\s*$/i,                       // Yes/No confirmation (default no)
  /\[Y\/n\]\s*$/i,                       // Bracket yes/no
  /\[y\/N\]\s*$/i,                       // Bracket yes/no (default no)
  /\(yes\/no\)\s*$/i,                    // Full yes/no prompt
  /❯\s*\d+\.\s/,                        // Claude TUI selector (❯ 1. Yes)
  /\d+\.\s+Yes,?\s+and\s+don'?t\s+ask/i, // "Yes and don't ask again" option
];

// Patterns indicating Claude finished a generation (output completed)
const COMPLETION_PATTERNS = [
  /Total cost:/i,                        // Cost summary appeared
  /Session cost:/i,                      // Session cost line
];

/**
 * Check if terminal output looks like it's waiting for user input.
 */
function isPromptWaiting(rawData) {
  const clean = stripAnsi(rawData).trim();
  if (!clean) return false;

  // Check the last few lines for prompt patterns
  const lines = clean.split('\n');
  const lastLines = lines.slice(-3).join('\n');

  return PROMPT_PATTERNS.some(pattern => pattern.test(lastLines));
}

/**
 * Check if output indicates generation completion.
 */
function isGenerationComplete(rawData) {
  const clean = stripAnsi(rawData).trim();
  return COMPLETION_PATTERNS.some(pattern => pattern.test(clean));
}

// Cost parsing patterns
const COST_PATTERNS = {
  sessionCost: /Session cost:\s*\$?([\d,.]+)/i,
  totalCost: /Total cost:\s*\$?([\d,.]+)/i,
  totalTokens: /Total tokens?:\s*([\d,]+k?)/i,
  inputTokens: /Input tokens?:\s*([\d,]+k?)/i,
  outputTokens: /Output tokens?:\s*([\d,]+k?)/i,
  cacheRead: /Cache read(?:\s+tokens?)?:\s*([\d,]+k?)/i,
  cacheWrite: /Cache write(?:\s+tokens?)?:\s*([\d,]+k?)/i,
  contextUsed: /used\s+([\d.]+)%/i,
  contextWindow: /Context(?:\s+window)?:\s*([\d.]+%?\s*(?:used|remaining)?)/i,
  contextUsedAlt: /([\d.]+)%\s*(?:of context|used)/i,
};

/**
 * Parse cost and usage data from terminal output.
 * Returns an object with any detected cost/usage fields, or null if nothing found.
 */
function parseCostData(rawData) {
  const clean = stripAnsi(rawData);
  const result = {};
  let found = false;

  for (const [key, pattern] of Object.entries(COST_PATTERNS)) {
    const match = clean.match(pattern);
    if (match) {
      result[key] = match[1].trim();
      found = true;
    }
  }

  return found ? result : null;
}

/**
 * Accumulate output chunks and parse for status data.
 * This class buffers output and extracts cost/status info over time.
 */
class OutputAccumulator {
  constructor() {
    this.buffer = '';
    this.maxBufferSize = 8192;
    this.lastCostData = null;
  }

  /**
   * Add new output data and check for parseable content.
   * Returns { costData } if new data was parsed, null otherwise.
   */
  append(data) {
    this.buffer += data;

    // Trim buffer if it gets too large (keep the tail)
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize);
    }

    const costData = parseCostData(data);
    if (costData) {
      // Merge with existing cost data (keep latest values)
      this.lastCostData = { ...this.lastCostData, ...costData };
      return { costData: this.lastCostData };
    }

    return null;
  }

  /**
   * Get the last known cost data.
   */
  getLastCostData() {
    return this.lastCostData;
  }

  /**
   * Reset the accumulator.
   */
  reset() {
    this.buffer = '';
    this.lastCostData = null;
  }
}

module.exports = {
  ANSI_REGEX,
  stripAnsi,
  PROMPT_PATTERNS,
  COMPLETION_PATTERNS,
  isPromptWaiting,
  isGenerationComplete,
  COST_PATTERNS,
  parseCostData,
  OutputAccumulator,
};
