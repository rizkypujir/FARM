'use strict';
/**
 * Cek progress farming per wallet.
 * Sumber data:
 *   1. .farm-progress.json (live state — wallet yang sudah/lagi diproses di cycle saat ini)
 *   2. logs/farm-YYYYMMDD.log (history task ok/fail/skip per wallet)
 *
 * Usage:
 *   node scripts/checkProgress.js                # ringkasan semua wallet hari ini
 *   node scripts/checkProgress.js --pending      # cuma tampilkan wallet yang belum kelar 14 task
 *   node scripts/checkProgress.js --date 20260424  # log tanggal lain
 *   node scripts/checkProgress.js --wallet 0xabc.. # detail 1 wallet
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const PROGRESS_FILE = path.join(ROOT, '.farm-progress.json');

const TOTAL_TASKS = 14; // sesuai SEQUENCE di src/flows/farm.js

// ===== ANSI colors (no chalk dep biar ringan) =====
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  gray: '\x1b[90m',
};

function parseArgs() {
  const args = { pending: false, date: null, wallet: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pending') args.pending = true;
    else if (argv[i] === '--date') args.date = argv[++i];
    else if (argv[i] === '--wallet') args.wallet = argv[++i].toLowerCase();
  }
  return args;
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function loadWalletList() {
  // Coba beberapa sumber daftar wallet
  const candidates = [
    path.join(ROOT, 'wallets.addresses.txt'),
    path.join(ROOT, 'wallets.txt'),
  ];
  for (const fp of candidates) {
    if (!fs.existsSync(fp)) continue;
    const raw = fs.readFileSync(fp, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (raw.length === 0) continue;

    // wallets.txt = private keys; convert ke address
    if (fp.endsWith('wallets.txt')) {
      try {
        return raw.map((pk) => new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk).address);
      } catch (e) {
        console.error(c.red + 'Gagal parse wallets.txt: ' + e.message + c.reset);
        continue;
      }
    }
    // addresses file
    return raw.filter((s) => /^0x[0-9a-fA-F]{40}$/.test(s));
  }
  return [];
}

function loadProgress() {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) return null;
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function parseLog(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stats = { perWallet: new Map(), totalLines: 0 };
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    if (!line) continue;
    stats.totalLines++;
    // Format: [timestamp] [tag] message
    const m = line.match(/^\[[^\]]+\]\s+\[([^\]]+)\]\s+(.*)$/);
    if (!m) continue;
    const [, tag, rest] = m;

    // Cari wallet address di message
    const addrMatch = rest.match(/(0x[0-9a-fA-F]{40})/);
    if (!addrMatch) continue;
    const addr = addrMatch[1].toLowerCase();

    if (!stats.perWallet.has(addr)) {
      stats.perWallet.set(addr, { ok: [], fail: [], skip: [], err: null });
    }
    const w = stats.perWallet.get(addr);

    if (tag === 'task:ok') {
      // task:ok 0x... taskname
      const parts = rest.split(/\s+/);
      const taskName = parts[1] || '?';
      w.ok.push(taskName);
    } else if (tag === 'task:fail') {
      const parts = rest.split(/\s+/);
      const taskName = parts[1] || '?';
      const reason = rest.split('::')[1]?.trim() || '';
      w.fail.push({ task: taskName, reason });
    } else if (tag === 'task:skip') {
      const parts = rest.split(/\s+/);
      const taskName = parts[1] || '?';
      w.skip.push(taskName);
    } else if (tag === 'wallet:err') {
      w.err = rest.split('::')[1]?.trim() || rest;
    } else if (tag === 'wallet:skip') {
      w.walletSkip = rest;
    }
  }
  return stats;
}

function fmtAddr(a) {
  return a.slice(0, 6) + '..' + a.slice(-4);
}

function main() {
  const args = parseArgs();
  const dateStr = args.date || todayStamp();
  const logFile = path.join(LOG_DIR, `farm-${dateStr}.log`);

  console.log('');
  console.log(c.cyan + c.bold + 'ARC FARM — Progress Check' + c.reset);
  console.log(c.gray + 'Log file: ' + logFile + c.reset);

  const allWallets = loadWalletList();
  const progress = loadProgress();
  const stats = parseLog(logFile);

  if (!stats) {
    console.log(c.red + `\nLog file tidak ditemukan: ${logFile}` + c.reset);
    console.log(c.gray + 'Mungkin farm belum jalan hari ini, atau coba --date YYYYMMDD' + c.reset);
    process.exit(1);
  }

  console.log(c.gray + `Total log lines: ${stats.totalLines} | Wallets in log: ${stats.perWallet.size}` + c.reset);
  if (allWallets.length) console.log(c.gray + `Wallets in config: ${allWallets.length}` + c.reset);
  if (progress) {
    const ageMin = ((Date.now() - progress.startedAt) / 60000).toFixed(1);
    console.log(c.gray + `Active cycle: started ${ageMin} min ago, done=${progress.done.length}/${progress.total}` + c.reset);
  }
  console.log('');

  // Mode: detail 1 wallet
  if (args.wallet) {
    const w = stats.perWallet.get(args.wallet);
    if (!w) {
      console.log(c.red + `Wallet ${args.wallet} tidak ada di log` + c.reset);
      process.exit(1);
    }
    console.log(c.bold + `Wallet: ${args.wallet}` + c.reset);
    console.log(c.green + `  ok    (${w.ok.length}): ${w.ok.join(', ') || '-'}` + c.reset);
    console.log(c.red   + `  fail  (${w.fail.length}): ${w.fail.map((f) => f.task).join(', ') || '-'}` + c.reset);
    if (w.fail.length) {
      console.log(c.gray + '  fail reasons:' + c.reset);
      w.fail.forEach((f) => console.log(c.gray + `    - ${f.task}: ${f.reason}` + c.reset));
    }
    console.log(c.yellow + `  skip  (${w.skip.length}): ${w.skip.join(', ') || '-'}` + c.reset);
    if (w.err) console.log(c.red + `  err: ${w.err}` + c.reset);
    return;
  }

  // Daftar wallet untuk diperiksa
  const universe = allWallets.length
    ? allWallets.map((a) => a.toLowerCase())
    : Array.from(stats.perWallet.keys());

  // Buat ringkasan
  const rows = universe.map((addr) => {
    const s = stats.perWallet.get(addr);
    if (!s) {
      return { addr, status: 'NOT_RUN', ok: 0, fail: 0, skip: 0, completed: 0 };
    }
    const completed = s.ok.length + s.skip.length; // skip dihitung "selesai" karena memang gak ada balance
    const status =
      s.walletSkip ? 'WALLET_SKIPPED'
      : completed >= TOTAL_TASKS ? 'DONE'
      : s.fail.length === 0 ? 'IN_PROGRESS'
      : 'PARTIAL';
    return { addr, status, ok: s.ok.length, fail: s.fail.length, skip: s.skip.length, completed, failedTasks: s.fail.map((f) => f.task) };
  });

  // Filter pending kalau diminta
  const display = args.pending
    ? rows.filter((r) => r.status !== 'DONE' && r.status !== 'WALLET_SKIPPED')
    : rows;

  // Print table
  const statusColor = {
    DONE: c.green,
    PARTIAL: c.yellow,
    IN_PROGRESS: c.cyan,
    NOT_RUN: c.gray,
    WALLET_SKIPPED: c.gray,
  };

  console.log(c.bold + 'Idx  Wallet              Status         Tasks                Failed tasks' + c.reset);
  console.log(c.gray + '─'.repeat(95) + c.reset);
  display.forEach((r, i) => {
    const idx = String(i + 1).padStart(3);
    const addr = fmtAddr(r.addr);
    const col = statusColor[r.status] || c.reset;
    const status = (col + r.status.padEnd(14) + c.reset);
    const tasks = `ok=${r.ok} fail=${r.fail} skip=${r.skip}`.padEnd(20);
    const failed = r.failedTasks ? r.failedTasks.join(',') : '';
    console.log(`${idx}  ${addr}      ${status} ${tasks} ${c.red}${failed}${c.reset}`);
  });

  // Summary
  const total = rows.length;
  const done = rows.filter((r) => r.status === 'DONE').length;
  const partial = rows.filter((r) => r.status === 'PARTIAL').length;
  const inProgress = rows.filter((r) => r.status === 'IN_PROGRESS').length;
  const notRun = rows.filter((r) => r.status === 'NOT_RUN').length;
  const skipped = rows.filter((r) => r.status === 'WALLET_SKIPPED').length;

  console.log(c.gray + '─'.repeat(95) + c.reset);
  console.log(c.bold + `Total: ${total}  |  ` + c.reset +
    c.green + `done=${done}  ` + c.reset +
    c.yellow + `partial=${partial}  ` + c.reset +
    c.cyan + `in_progress=${inProgress}  ` + c.reset +
    c.gray + `not_run=${notRun}  skipped=${skipped}` + c.reset);

  // Top failing tasks
  const failCount = new Map();
  rows.forEach((r) => {
    if (r.failedTasks) r.failedTasks.forEach((t) => failCount.set(t, (failCount.get(t) || 0) + 1));
  });
  if (failCount.size) {
    console.log('');
    console.log(c.bold + 'Top failing tasks:' + c.reset);
    [...failCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([t, n]) => console.log(`  ${c.red}${n}x${c.reset}  ${t}`));
  }

  console.log('');
}

main();
