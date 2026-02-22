'use strict';

const fs = require('fs');
const path = require('path');

const SSL_DIR = path.join(__dirname, '..', '.ssl');
const CERT_PATH = path.join(SSL_DIR, 'cert.pem');
const KEY_PATH = path.join(SSL_DIR, 'key.pem');

/**
 * Get existing certs or generate new self-signed ones.
 * Returns { cert, key } or null if generation fails.
 */
async function getOrCreateCerts() {
  // Reuse existing certs if found
  try {
    if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
      return {
        cert: fs.readFileSync(CERT_PATH, 'utf-8'),
        key: fs.readFileSync(KEY_PATH, 'utf-8'),
      };
    }
  } catch (err) {
    // Fall through to generation
  }

  // Generate new self-signed cert (selfsigned v5+ is async)
  try {
    const selfsigned = require('selfsigned');
    const attrs = [{ name: 'commonName', value: 'claude-remote' }];
    const pems = await selfsigned.generate(attrs, {
      keySize: 2048,
      days: 365,
      algorithm: 'sha256',
    });

    fs.mkdirSync(SSL_DIR, { recursive: true });
    fs.writeFileSync(CERT_PATH, pems.cert, 'utf-8');
    fs.writeFileSync(KEY_PATH, pems.private, 'utf-8');

    return { cert: pems.cert, key: pems.private };
  } catch (err) {
    return null;
  }
}

module.exports = { getOrCreateCerts, SSL_DIR, CERT_PATH, KEY_PATH };
