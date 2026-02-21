#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');

const urlFile = path.join(__dirname, '.tunnel-url');

if (!fs.existsSync(urlFile)) {
  console.error('[snorlax] No tunnel URL found. Is the server running? (npm start)');
  process.exit(1);
}

const url = fs.readFileSync(urlFile, 'utf-8').trim();
console.log(`\n  ${url}\n`);
qrcode.generate(url, { small: true });
