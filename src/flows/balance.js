'use strict';
const chalk = require('chalk');
const ora = require('ora');
const { ethers } = require('ethers');
const chain = require('../../config/chain');
const erc20Abi = require('../abi/erc20');
const { getProvider } = require('../provider');
const { loadWallets } = require('../wallets');
const { shortAddr } = require('../utils');

async function runBalance() {
  const wallets = loadWallets();
  const provider = getProvider();
  const usdc = new ethers.Contract(chain.tokens.USDC.address, erc20Abi, provider);
  const eurc = new ethers.Contract(chain.tokens.EURC.address, erc20Abi, provider);

  const spinner = ora(`Checking ${wallets.length} wallet(s)...`).start();
  const rows = [];
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    spinner.text = `Checking ${i + 1}/${wallets.length}  ${shortAddr(w.address)}`;
    try {
      const [nativeBal, u, e] = await Promise.all([
        provider.getBalance(w.address),
        usdc.balanceOf(w.address).catch(() => 0n),
        eurc.balanceOf(w.address).catch(() => 0n),
      ]);
      rows.push({
        addr: w.address,
        native: ethers.formatEther(nativeBal),
        usdc: ethers.formatUnits(u, 6),
        eurc: ethers.formatUnits(e, 6),
      });
    } catch (err) {
      rows.push({ addr: w.address, error: err.message });
    }
  }
  spinner.succeed(`Checked ${wallets.length} wallets`);

  console.log('');
  console.log(
    chalk.bold('  #  Address             Native       USDC           EURC')
  );
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────'));
  rows.forEach((r, i) => {
    const idx = String(i + 1).padStart(2);
    if (r.error) {
      console.log(`  ${idx}  ${shortAddr(r.addr)}  ${chalk.red('ERR: ' + r.error)}`);
    } else {
      console.log(
        `  ${idx}  ${shortAddr(r.addr)}  ${String(r.native).padEnd(10)}  ${String(r.usdc).padEnd(12)}  ${r.eurc}`
      );
    }
  });
  console.log('');
}

module.exports = { runBalance };
