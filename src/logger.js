'use strict';
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function stamp() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

function todayFile() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `farm-${y}${m}${day}.log`);
}

function write(tag, msg) {
  const line = `[${stamp()}] [${tag}] ${msg}\n`;
  try {
    fs.appendFileSync(todayFile(), line);
  } catch (_) {}
}

function logFile(tag, ...parts) {
  const msg = parts
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ');
  write(tag, msg);
}

module.exports = { logFile, todayFile, LOG_DIR };
