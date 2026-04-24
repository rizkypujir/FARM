'use strict';
const chalk = require('chalk');
const ora = require('ora');
const { loadPrivateKeys } = require('../wallets');
const { bridgeOne } = require('../bridge/cctp');
const { shortAddr } = require('../utils');
const { logFile } = require('../logger');
const tg = require('../telegram');

async function runBridge({ amountUsdc, destAddress, parallel = true }) {
  const pks = loadPrivateKeys();
  if (!pks.length) throw new Error('Tidak ada wallet.');

  console.log('');
  console.log(
    chalk.cyan(
      `Bridging ${amountUsdc} USDC Sepolia -> Arc for ${pks.length} wallet(s) [${parallel ? 'parallel' : 'sequential'}]...`
    )
  );
  console.log('');

  if (tg.isEnabled()) {
    await tg.sendMessage(`🌉 <b>Bridge started</b>\nAmount: ${amountUsdc} USDC\nWallets: ${pks.length}`);
  }

  const { ethers } = require('ethers');
  const addrs = pks.map((pk) => new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk).address);
  const spinner = ora({ text: 'starting...' }).start();
  const state = pks.map(() => 'queued');
  const results = new Array(pks.length);
  const t0 = Date.now();

  function tick() {
    const done = state.filter((s) => s === 'ok' || s === 'fail').length;
    const running = state.filter((s) => s === 'running').length;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    spinner.text = `Bridging  ${done}/${pks.length} done, ${running} running  (${elapsed}s elapsed)`;
  }
  const ticker = setInterval(tick, 500);

  async function doOne(i) {
    const pk = pks[i];
    state[i] = 'running';
    const origLog = console.log;
    const silent = (...args) => logFile('bridge', args.map(String).join(' '));
    if (!parallel) console.log = silent;
    try {
      // Saat parallel: biarkan console.log bocor tapi akan overlap—lebih aman redirect juga.
      if (parallel) console.log = silent;
      const { burnHash, mintHash } = await bridgeOne(pk, amountUsdc, destAddress || null);
      results[i] = { ok: true, addr: addrs[i], burnHash, mintHash };
      state[i] = 'ok';
    } catch (e) {
      results[i] = { ok: false, addr: addrs[i], error: e.shortMessage || e.message };
      state[i] = 'fail';
      logFile('bridge', `ERR ${addrs[i]}: ${e.message}`);
    } finally {
      console.log = origLog;
    }
  }

  if (parallel) {
    await Promise.all(pks.map((_, i) => doOne(i)));
  } else {
    for (let i = 0; i < pks.length; i++) await doOne(i);
  }

  clearInterval(ticker);

  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  spinner.stopAndPersist({
    symbol: fail === 0 ? chalk.green('✔') : chalk.yellow('!'),
    text: `Bridge done  ok=${ok} fail=${fail}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  });

  console.log('');
  results.forEach((r, i) => {
    const idx = String(i + 1).padStart(2);
    if (r.ok) {
      console.log(`  ${idx}  ${shortAddr(r.addr)}  ${chalk.green('✔ done')}`);
    } else {
      console.log(`  ${idx}  ${shortAddr(r.addr)}  ${chalk.red('✖ ' + r.error)}`);
    }
  });
  console.log('');

  if (tg.isEnabled()) {
    await tg.sendMessage(`🏁 <b>Bridge finished</b>\n${ok}/${results.length} wallets ok  |  ${fail} failed`);
  }
}

module.exports = { runBridge };
