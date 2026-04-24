'use strict';
const chalk = require('chalk');
const ora = require('ora');
const { loadPrivateKeys } = require('../wallets');
const { resumeBridge } = require('../bridge/cctp');
const { shortAddr } = require('../utils');
const { logFile } = require('../logger');

async function runResume({ burnTxHash, walletIndex = 0 }) {
  const pks = loadPrivateKeys();
  if (!pks.length) throw new Error('Tidak ada wallet.');
  if (walletIndex >= pks.length) throw new Error(`Wallet index ${walletIndex} di luar range (${pks.length} wallet)`);

  const pk = pks[walletIndex];
  const { ethers } = require('ethers');
  const addr = new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk).address;

  console.log('');
  console.log(chalk.cyan(`Resume bridge untuk burn tx: ${burnTxHash}`));
  console.log(chalk.cyan(`Wallet submit mint: ${shortAddr(addr)}`));
  console.log('');

  const spinner = ora({ text: 'fetching attestation dari Circle...' }).start();

  const origLog = console.log;
  console.log = (...args) => {
    const msg = args.map(String).join(' ');
    logFile('resume', msg);
    if (msg.includes('attestation status=')) spinner.text = msg;
    if (msg.includes('attestation ready')) spinner.text = 'attestation OK, minting di Arc...';
  };

  try {
    const { mintHash } = await resumeBridge(pk, burnTxHash);
    console.log = origLog;
    spinner.succeed(chalk.green('Resume done!'));
    console.log('');
    console.log(`  Mint tx: https://testnet.arcscan.app/tx/${mintHash}`);
    console.log('');
  } catch (e) {
    console.log = origLog;
    spinner.fail(chalk.red('Resume gagal: ' + (e.shortMessage || e.message)));
    throw e;
  }
}

module.exports = { runResume };
