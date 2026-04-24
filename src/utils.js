'use strict';
const chain = require('../config/chain');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randInt(min, max) {
  min = Math.floor(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randDelay(minMs, maxMs) {
  return sleep(randInt(minMs, maxMs));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shortAddr(a) {
  return a ? a.slice(0, 6) + '..' + a.slice(-4) : '';
}

function txUrl(hash) {
  return `${chain.explorer}/tx/${hash}`;
}

function now() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function log(tag, ...msg) {
  console.log(`[${now()}] [${tag}]`, ...msg);
}

function randomName(prefix) {
  const hex = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${prefix}${hex.toUpperCase()}`;
}

const TRANSIENT_PATTERNS = [
  'could not coalesce error',
  'network',
  'timeout',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNABORTED',
  'socket hang up',
  'ENOTFOUND',
  'EAI_AGAIN',
  '502',
  '503',
  '504',
  'rate limit',
  '429',
  'SERVER_ERROR',
  'replacement fee too low',
];

function isTransient(err) {
  const msg = (err?.shortMessage || err?.message || String(err || '')).toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => msg.includes(p.toLowerCase()));
}

function withTimeout(promise, ms, label = 'op') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function withRetry(fn, { retries = 3, baseDelayMs = 2000, label = 'op', timeoutMs } = {}) {
  // Default 300s: cukup untuk task multi-tx (mis. zkCounter×3 @90s each). Single-tx task
  // biasanya selesai <10s — timeout ini cuma safety net untuk RPC hang.
  const taskTimeout = timeoutMs || Number(process.env.TASK_TIMEOUT_MS || 300000);
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await withTimeout(Promise.resolve().then(fn), taskTimeout, label);
    } catch (e) {
      lastErr = e;
      const isTimeout = /timeout after \d+ms/.test(e?.message || '');
      if (i === retries || (!isTransient(e) && !isTimeout)) throw e;
      const wait = baseDelayMs * Math.pow(2, i) + Math.floor(Math.random() * 1000);
      log('retry', `${label} attempt ${i + 1}/${retries} failed (${e.shortMessage || e.message}). retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

module.exports = { sleep, randInt, randDelay, pick, shortAddr, txUrl, log, randomName, withRetry, withTimeout, isTransient };
