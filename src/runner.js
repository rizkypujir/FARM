'use strict';
require('dotenv').config();
const chain = require('../config/chain');
const { loadWallets } = require('./wallets');
const { balanceOf } = require('./tasks/balance');
const { resolveEnabled } = require('./tasks');
const { log, shortAddr, pick, randDelay, sleep, randInt } = require('./utils');

const TX_PER_WALLET = Number(process.env.TX_PER_WALLET || 10);
const DELAY_MIN = Number(process.env.DELAY_MIN_MS || 3000);
const DELAY_MAX = Number(process.env.DELAY_MAX_MS || 9000);
const W_DELAY_MIN = Number(process.env.WALLET_DELAY_MIN_MS || 5000);
const W_DELAY_MAX = Number(process.env.WALLET_DELAY_MAX_MS || 15000);
const PARALLEL = String(process.env.PARALLEL_WALLETS || 'false').toLowerCase() === 'true';
const LOOP = String(process.env.LOOP || 'false').toLowerCase() === 'true';
const LOOP_MIN = Number(process.env.LOOP_DELAY_MIN_MS || 300000);
const LOOP_MAX = Number(process.env.LOOP_DELAY_MAX_MS || 900000);

async function runWallet(wallet, tasks) {
  const tag = `w:${shortAddr(wallet.address)}`;
  try {
    const b = await balanceOf(wallet);
    log(tag, `balance  native=${b.native}  USDC=${b.usdc}  EURC=${b.eurc}`);
  } catch (e) {
    log(tag, `balance ERR: ${e.message}`);
  }

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < TX_PER_WALLET; i++) {
    const task = pick(tasks);
    log(tag, `tx ${i + 1}/${TX_PER_WALLET} -> ${task.name}`);
    try {
      await task.run(wallet);
      ok++;
    } catch (e) {
      fail++;
      const msg = (e.shortMessage || e.message || String(e)).slice(0, 160);
      log(tag, `  ERR (${task.name}): ${msg}`);
    }
    if (i < TX_PER_WALLET - 1) await randDelay(DELAY_MIN, DELAY_MAX);
  }
  log(tag, `done  ok=${ok}  fail=${fail}`);
  return { ok, fail };
}

async function runOnce() {
  const wallets = loadWallets();
  const tasks = resolveEnabled();
  if (!tasks.length) throw new Error('ENABLED_TASKS kosong atau tidak valid');

  log('runner', `Arc Testnet farm  wallets=${wallets.length}  tasks=${tasks.map((t) => t.name).join(',')}`);
  log('runner', `tx/wallet=${TX_PER_WALLET}  parallel=${PARALLEL}  rpc=${chain.rpcUrl}`);

  if (PARALLEL) {
    const results = await Promise.all(wallets.map((w) => runWallet(w, tasks)));
    const agg = results.reduce(
      (a, r) => ({ ok: a.ok + r.ok, fail: a.fail + r.fail }),
      { ok: 0, fail: 0 }
    );
    log('runner', `TOTAL  ok=${agg.ok}  fail=${agg.fail}`);
  } else {
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < wallets.length; i++) {
      const r = await runWallet(wallets[i], tasks);
      ok += r.ok;
      fail += r.fail;
      if (i < wallets.length - 1) await randDelay(W_DELAY_MIN, W_DELAY_MAX);
    }
    log('runner', `TOTAL  ok=${ok}  fail=${fail}`);
  }
}

async function main() {
  if (!LOOP) return runOnce();
  let cycle = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    log('runner', `=== CYCLE ${cycle} ===`);
    try {
      await runOnce();
    } catch (e) {
      log('runner', `cycle error: ${e.message}`);
    }
    const wait = randInt(LOOP_MIN, LOOP_MAX);
    log('runner', `sleeping ${Math.round(wait / 1000)}s before next cycle`);
    await sleep(wait);
    cycle++;
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { runOnce };
