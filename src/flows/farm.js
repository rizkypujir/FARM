'use strict';
const chalk = require('chalk');
const ora = require('ora');
const { ethers } = require('ethers');
const chain = require('../../config/chain');
const { loadWallets } = require('../wallets');
const { shortAddr, randDelay, withRetry } = require('../utils');
const { logFile } = require('../logger');
const tg = require('../telegram');
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

function silenceConsole() {
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
    // Kalau RPC error, anggap funded aja biar tetap dicoba
    return { funded: true, balance: '?' };
  }
}

async function runWallet(wallet, idx, total, spinner) {
  const base = `${idx + 1}/${total} ${shortAddr(wallet.address)}`;
  let ok = 0;
  let fail = 0;
  const t0 = Date.now();

  // Preflight: skip wallet yang saldo USDC di bawah minimum
  spinner.text = `${base}  checking balance...`;
  const chk = await checkWalletFunded(wallet);
  if (!chk.funded) {
    logFile('wallet:skip', `${wallet.address} skipped: USDC=${chk.balance} < ${MIN_USDC_FARM}`);
    return { ok: 0, fail: 0, skipped: true, secs: '0.0', addr: wallet.address, balance: chk.balance };
  }

  for (let i = 0; i < SEQUENCE.length; i++) {
    const t = SEQUENCE[i];
    spinner.text = `${base}  [${i + 1}/${SEQUENCE.length}] ${t.name}`;
    const restore = silenceConsole();
    try {
      await withRetry(() => t.fn(wallet), { retries: 3, baseDelayMs: 3000, label: `${shortAddr(wallet.address)}:${t.name}` });
      ok++;
      logFile('task:ok', `${wallet.address} ${t.name}`);
    } catch (e) {
      fail++;
      logFile('task:fail', `${wallet.address} ${t.name} :: ${e.shortMessage || e.message}`);
    } finally {
      restore();
    }
    if (i < SEQUENCE.length - 1) await randDelay(DELAY_MIN, DELAY_MAX);
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  return { ok, fail, secs, addr: wallet.address };
}

async function runFarmOnce() {
  const wallets = loadWallets();
  const total = wallets.length;

  console.log('');
  console.log(chalk.cyan(`Starting farming cycle — ${total} wallet(s) × ${SEQUENCE.length} tasks`));
  console.log('');

  if (tg.isEnabled()) {
    await tg.sendMessage(`🚀 <b>Arc Farm cycle started</b>\nWallets: ${total} | Tasks/wallet: ${SEQUENCE.length}`);
  }

  const spinner = ora({ text: 'starting...' }).start();
  const results = [];
  const cycleStart = Date.now();

  for (let i = 0; i < total; i++) {
    try {
      const r = await runWallet(wallets[i], i, total, spinner);
      results.push(r);
    } catch (e) {
      results.push({ addr: wallets[i].address, ok: 0, fail: SEQUENCE.length, secs: '0', error: e.message });
      logFile('wallet:err', `${wallets[i].address} :: ${e.message}`);
    }
  }

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

  return { totalOk, totalFail, fullyOk, total, cycleSecs };
}

module.exports = { runFarmOnce, SEQUENCE };
