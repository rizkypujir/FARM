'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { makeWallet } = require('./provider');

function loadPrivateKeys() {
  // Prioritas: WALLETS_FILE env > wallets.txt (default) > PRIVATE_KEYS env
  const file = process.env.WALLETS_FILE || 'wallets.txt';
  const fp = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (fs.existsSync(fp)) {
    const lines = fs
      .readFileSync(fp, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'));
    if (lines.length) return lines;
  }
  const env = process.env.PRIVATE_KEYS || '';
  return env
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadWallets() {
  const pks = loadPrivateKeys();
  if (!pks.length) {
    throw new Error(
      'Tidak ada private key. Set PRIVATE_KEYS di .env atau isi wallets.txt'
    );
  }
  return pks.map((pk) => makeWallet(pk));
}

module.exports = { loadWallets, loadPrivateKeys };
