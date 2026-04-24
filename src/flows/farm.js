'use strict';
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const { ethers } = require('ethers');
const chain = require('../../config/chain');
const { loadWallets } = require('../wallets');
const { shortAddr, randDelay, withRetry } = require('../utils');
const { logFile } = require('../logger');
const tg = require('../telegram');

// Progress file — supaya cycle yang terputus bisa resume tanpa ulang wallet yang udah selesai.
const PROGRESS_FILE = path.join(__dirname, '..', '..', '.farm-progress.json');

function loadProgress(totalWallets) {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) return null;
    const p = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    // Invalidate kalau wallet count beda (wallets.txt berubah) atau umur >24 jam
    const ageH = (Date.now() - (p.startedAt || 0)) / 3600000;
    if (p.total !== totalWallets || ageH > 24) return null;
    return p;
  } catch {
    return null;
  }
}

function saveProgress(p) {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
  } catch (e) {
    logFile('progress:err', 'save failed: ' + e.message);
  }
}

function clearProgress() {
  try { fs.unlinkSync(PROGRESS_FILE); } catch {}
}
const transfer = require('../tasks/transfer');
const approve = require('../tasks/approve');
const deploy = require('../tasks/deploy');
const { deployErc20Real } = require('../tasks/deployErc20Real');
const { deployNftReal } = require('../tasks/deployNftReal');
const zk = require('../tasks/zkcodex');

const SELF_USDC = process.env.SELF_TX_AMOUNT_USDC || '0.001';
const SELF_EURC = process.env.SELF_TX_AMOUNT_EURC || '0.001';
const DELAY_MIN = Number(process.env.DELAY_MIN_MS || 1500);
const DELAY_MAX = Number(process.env.DELAY_MAX_MS || 4000);
const COUNTER_PER_CYCLE = Number(process.env.COUNTER_PER_CYCLE || 3);
// Minimal USDC (= gas token Arc) yang harus dipunyai wallet untuk jalanin task.
// Kalau kurang, skip wallet supaya gak stuck retry di task yang butuh balance.
const MIN_USDC_FARM = process.env.MIN_USDC_FARM || '0.05';
// Jumlah wallet yang jalan bareng dalam 1 batch. Default 5 — aman untuk RPC publik.
// Naikin kalau pakai RPC private (Alchemy/QuickNode) dengan rate limit tinggi.
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 5);

// Urutan task penuh (sequential per wallet)
const SEQUENCE = [
  // Native token transfers
  { name: 'selfTransferUsdc', fn: (w) => transfer.selfTransferUsdc(w, SELF_USDC) },
  { name: 'selfTransferEurc', fn: (w) => transfer.selfTransferEurc(w, SELF_EURC) },
  { name: 'randomTransferUsdc', fn: (w) => transfer.randomTransferUsdc(w, SELF_USDC) },
  { name: 'randomTransferEurc', fn: (w) => transfer.randomTransferEurc(w, SELF_EURC) },
  // Approve StableFX
  { name: 'approveUsdcFx', fn: (w) => approve.approveUsdcFx(w) },
  { name: 'approveEurcFx', fn: (w) => approve.approveEurcFx(w) },
  // Local deploy
  { name: 'deployBasic', fn: (w) => deploy.deployMinimal(w) },
  { name: 'deployErc20', fn: (w) => deployErc20Real(w) },
  { name: 'deployNft+mint', fn: (w) => deployNftReal(w) },
  // zkCodex tasks
  { name: 'zkDeploySimple', fn: (w) => zk.zkDeploySimple(w) },
  { name: 'zkDeployToken', fn: (w) => zk.zkDeployToken(w) },
  { name: 'zkDeployNft', fn: (w) => zk.zkDeployNft(w) },
  { name: 'zkGm', fn: (w) => zk.zkGm(w) },
  { name: `zkCounter×${COUNTER_PER_CYCLE}`, fn: (w) => zk.zkCounterMany(w, COUNTER_PER_CYCLE) },
];

// Install sekali di level cycle — parallel-safe. Semua console.log task -> log file.
function installSilencer() {
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => logFile('task', a.map(String).join(' '));
  console.error = (...a) => logFile('task:err', a.map(String).join(' '));
  return () => {
    console.log = orig.log;
    console.error = orig.error;
  };
}

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

async function checkWalletFunded(wallet) {
  try {
    const usdc = new ethers.Contract(chain.tokens.USDC.address, ERC20_ABI, wallet.provider);
    const bal = await usdc.balanceOf(wallet.address);
    const min = ethers.parseUnits(MIN_USDC_FARM, 6);
    return { funded: bal >= min, balance: ethers.formatUnits(bal, 6) };
  } catch (e) {
    return { funded: true, balance: '?' };
  }
}

// Parallel-safe: tidak sentuh spinner, tidak install silencer per-wallet.
// Caller (runFarmOnce) yang install silencer sekali di awal cycle.
async function runWallet(wallet, onTask) {
  const short = shortAddr(wallet.address);
  let ok = 0;
  let fail = 0;
  const t0 = Date.now();

  const chk = await checkWalletFunded(wallet);
  if (!chk.funded) {
    logFile('wallet:skip', `${wallet.address} skipped: USDC=${chk.balance} < ${MIN_USDC_FARM}`);
    return { ok: 0, fail: 0, skipped: true, secs: '0.0', addr: wallet.address, balance: chk.balance };
  }

  for (let i = 0; i < SEQUENCE.length; i++) {
    const t = SEQUENCE[i];
    if (onTask) onTask({ addr: wallet.address, taskIdx: i + 1, taskTotal: SEQUENCE.length, taskName: t.name });
    try {
      await withRetry(() => t.fn(wallet), { retries: 3, baseDelayMs: 3000, label: `${short}:${t.name}` });
      ok++;
      logFile('task:ok', `${wallet.address} ${t.name}`);
    } catch (e) {
      fail++;
      logFile('task:fail', `${wallet.address} ${t.name} :: ${e.shortMessage || e.message}`);
    }
    if (i < SEQUENCE.length - 1) await randDelay(DELAY_MIN, DELAY_MAX);
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  return { ok, fail, secs, addr: wallet.address };
}

async function runFarmOnce() {
  const wallets = loadWallets();
  const total = wallets.length;

  // Cek progress sebelumnya — resume kalau ada cycle yang belum selesai (<24h, wallet count sama)
  const prev = loadProgress(total);
  const doneSet = new Set(prev?.done || []);
  const results = prev?.results || [];
  const cycleStart = prev?.startedAt || Date.now();

  // Ambil daftar wallet yang belum diproses
  const pending = wallets.filter((w) => !doneSet.has(w.address.toLowerCase()));

  console.log('');
  if (prev && doneSet.size > 0) {
    console.log(chalk.yellow(`Resuming cycle — ${doneSet.size}/${total} wallets already done, ${pending.length} remaining`));
  } else {
    console.log(chalk.cyan(`Starting farming cycle — ${total} wallet(s) × ${SEQUENCE.length} tasks  |  batch=${BATCH_SIZE} parallel`));
  }
  console.log('');

  if (tg.isEnabled()) {
    const msg = prev && doneSet.size > 0
      ? `♻️ <b>Arc Farm cycle resumed</b>\nDone: ${doneSet.size}/${total} | Remaining: ${pending.length} | Batch: ${BATCH_SIZE}`
      : `🚀 <b>Arc Farm cycle started</b>\nWallets: ${total} | Tasks/wallet: ${SEQUENCE.length} | Batch: ${BATCH_SIZE}`;
    await tg.sendMessage(msg);
  }

  const spinner = ora({ text: 'starting...' }).start();
  const restoreConsole = installSilencer();

  // Save initial progress
  saveProgress({ startedAt: cycleStart, total, done: Array.from(doneSet), results });

  // Track per-wallet task progress untuk spinner text
  const liveTasks = new Map(); // addr -> { taskIdx, taskName }
  const batches = Math.ceil(pending.length / BATCH_SIZE);
  let batchIdx = 0;
  let walletsDoneInCycle = 0;

  const renderSpinner = () => {
    const live = [...liveTasks.entries()]
      .map(([addr, t]) => `${shortAddr(addr)}[${t.taskIdx}/${t.taskTotal}]`)
      .join(' ');
    spinner.text = `Batch ${batchIdx}/${batches}  done=${doneSet.size}/${total}  active: ${live || '-'}`;
  };

  for (let b = 0; b < pending.length; b += BATCH_SIZE) {
    batchIdx++;
    const batch = pending.slice(b, b + BATCH_SIZE);

    // Pre-register semua wallet di batch — kalau process mati, semua batch ini auto-skip saat restart
    for (const w of batch) doneSet.add(w.address.toLowerCase());
    saveProgress({ startedAt: cycleStart, total, done: Array.from(doneSet), results });

    renderSpinner();

    const onTask = (info) => {
      liveTasks.set(info.addr, info);
      renderSpinner();
    };

    // Jalankan batch paralel
    const settled = await Promise.allSettled(batch.map((w) => runWallet(w, onTask)));

    for (let k = 0; k < batch.length; k++) {
      const w = batch[k];
      liveTasks.delete(w.address);
      const s = settled[k];
      if (s.status === 'fulfilled') {
        results.push(s.value);
      } else {
        results.push({ addr: w.address, ok: 0, fail: SEQUENCE.length, secs: '0', error: s.reason?.message });
        logFile('wallet:err', `${w.address} :: ${s.reason?.message}`);
      }
      walletsDoneInCycle++;
    }

    saveProgress({ startedAt: cycleStart, total, done: Array.from(doneSet), results });
  }

  restoreConsole();

  const totalOk = results.reduce((a, r) => a + r.ok, 0);
  const totalFail = results.reduce((a, r) => a + r.fail, 0);
  const skipped = results.filter((r) => r.skipped).length;
  const active = total - skipped;
  const cycleSecs = ((Date.now() - cycleStart) / 1000).toFixed(1);
  const fullyOk = results.filter((r) => !r.skipped && r.fail === 0).length;

  spinner.stopAndPersist({
    symbol: totalFail === 0 ? chalk.green('✔') : chalk.yellow('!'),
    text: `Cycle done  ${fullyOk}/${active} active wallets fully ok  |  skipped=${skipped}  ok=${totalOk} fail=${totalFail}  |  ${cycleSecs}s`,
  });

  console.log('');
  results.forEach((r, i) => {
    const idx = String(i + 1).padStart(2);
    let mark, line;
    if (r.skipped) {
      mark = chalk.gray('○');
      line = `  ${mark} ${idx}  ${shortAddr(r.addr)}  ${chalk.gray(`SKIPPED (USDC=${r.balance} < ${MIN_USDC_FARM})`)}`;
    } else {
      mark = r.fail === 0 ? chalk.green('✔') : chalk.yellow('!');
      line = `  ${mark} ${idx}  ${shortAddr(r.addr)}  ok=${r.ok} fail=${r.fail}  (${r.secs}s)`;
    }
    console.log(line);
  });
  console.log('');

  if (tg.isEnabled()) {
    await tg.sendMessage(
      `🏁 <b>Arc Farm cycle done</b>\n` +
        `${fullyOk}/${active} active wallets fully ok\n` +
        `Skipped (low balance): ${skipped}\n` +
        `Total ok: ${totalOk} | fail: ${totalFail}\n` +
        `Duration: ${cycleSecs}s`
    );
  }

  // Cycle selesai — bersihin progress file supaya cycle berikutnya start fresh
  clearProgress();

  return { totalOk, totalFail, fullyOk, total, cycleSecs };
}

module.exports = { runFarmOnce, SEQUENCE };
