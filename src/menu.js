'use strict';
require('dotenv').config();
const chalk = require('chalk');
const chain = require('../config/chain');
const { loadPrivateKeys } = require('./wallets');
const { runBalance } = require('./flows/balance');
const { runBridge } = require('./flows/bridge');
const { runResume } = require('./flows/resume');
const { runFarmOnce } = require('./flows/farm');
const tg = require('./telegram');
const { sleep } = require('./utils');

// @inquirer/prompts v7 adalah ESM. Pakai dynamic import di CJS.
let _prompts = null;
async function prompts() {
  if (!_prompts) {
    _prompts = await import('@inquirer/prompts');
  }
  return _prompts;
}

const DAY_MS = 24 * 60 * 60 * 1000;

let dailyState = { running: false, nextAt: null, cycle: 0 };

function header() {
  console.clear();
  const wallets = loadPrivateKeys().length;
  const tgStat = tg.isEnabled() ? chalk.green('ON') : chalk.gray('OFF');
  const dailyStat = dailyState.running
    ? chalk.green(`RUNNING (cycle #${dailyState.cycle})`)
    : chalk.gray('IDLE');
  console.log('');
  console.log(chalk.cyan('╔════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║       ') + chalk.bold.white('ARC TESTNET FARM') + chalk.cyan('                     ║'));
  console.log(chalk.cyan('╠════════════════════════════════════════════╣'));
  console.log(
    chalk.cyan('║ ') +
      `Chain : ${chain.name} (${chain.chainId})`.padEnd(43) +
      chalk.cyan('║')
  );
  console.log(
    chalk.cyan('║ ') +
      `Wallets: ${wallets}`.padEnd(20) +
      `Telegram: ${tgStat}`.padEnd(27 + (tg.isEnabled() ? 9 : 10)) +
      chalk.cyan('║')
  );
  console.log(
    chalk.cyan('║ ') +
      `Daily : ${dailyStat}`.padEnd(43 + (dailyState.running ? 9 : 10)) +
      chalk.cyan('║')
  );
  console.log(chalk.cyan('╚════════════════════════════════════════════╝'));
  console.log('');
}

async function menuBalance() {
  header();
  try {
    await runBalance();
  } catch (e) {
    console.log(chalk.red('Error: ' + e.message));
  }
  await pause();
}

async function menuBridge() {
  const { input, confirm } = await prompts();
  header();
  const amount = await input({
    message: 'Amount USDC to bridge per wallet:',
    default: process.env.BRIDGE_AMOUNT_USDC || '1',
    validate: (v) => (!isNaN(Number(v)) && Number(v) > 0) || 'Masukkan angka > 0',
  });
  const dest = await input({
    message: 'Destination address di Arc (kosongkan = self):',
    default: '',
  });
  const parallel = await confirm({
    message: 'Jalankan semua wallet PARALEL? (lebih cepat, recommended)',
    default: true,
  });
  const ok = await confirm({ message: `Bridge ${amount} USDC untuk SEMUA wallet?`, default: false });
  if (!ok) return;
  try {
    await runBridge({ amountUsdc: amount, destAddress: dest || null, parallel });
  } catch (e) {
    console.log(chalk.red('Error: ' + e.message));
  }
  await pause();
}

async function menuResume() {
  const { input, select } = await prompts();
  header();
  console.log(chalk.yellow('Resume bridge: lanjutin mint di Arc untuk burn tx yang udah sukses di Sepolia.'));
  console.log(chalk.yellow('Berguna kalau koneksi putus / ISP intercept di tengah bridge sebelumnya.'));
  console.log('');

  const burnTxHash = await input({
    message: 'Burn tx hash (dari Sepolia):',
    validate: (v) => /^0x[0-9a-fA-F]{64}$/.test(v.trim()) || 'Format tx hash invalid (harus 0x + 64 hex)',
  });

  const pks = loadPrivateKeys();
  const { ethers } = require('ethers');
  const choices = pks.map((pk, i) => {
    const addr = new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk).address;
    return { name: `${i + 1}. ${addr}`, value: i };
  });
  const walletIndex = await select({
    message: 'Wallet mana yang submit mint tx di Arc? (butuh sedikit USDC di Arc untuk gas)',
    choices,
  });

  try {
    await runResume({ burnTxHash: burnTxHash.trim(), walletIndex });
  } catch (e) {
    console.log(chalk.red('Error: ' + (e.shortMessage || e.message)));
  }
  await pause();
}

async function menuDailyFarm() {
  const { confirm } = await prompts();
  header();
  console.log(chalk.yellow('Mode: Auto loop setiap 24 jam.'));
  console.log(chalk.yellow('Round pertama jalan SEKARANG, lalu tunggu 24 jam, ulang, dst.'));
  console.log(chalk.yellow('Tekan Ctrl+C untuk stop.'));
  console.log('');
  const ok = await confirm({ message: 'Mulai daily farming?', default: true });
  if (!ok) return;

  dailyState.running = true;
  dailyState.cycle = 0;

  try {
    // eslint-disable-next-line no-constant-condition
    while (dailyState.running) {
      dailyState.cycle++;
      header();
      console.log(chalk.bold(`═══ Cycle #${dailyState.cycle} — ${new Date().toISOString()} ═══`));
      try {
        await runFarmOnce();
      } catch (e) {
        console.log(chalk.red('Cycle error: ' + e.message));
      }
      dailyState.nextAt = new Date(Date.now() + DAY_MS);
      if (tg.isEnabled()) {
        await tg.sendMessage(
          `⏳ Next cycle: ${dailyState.nextAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`
        );
      }
      await countdown(DAY_MS);
    }
  } finally {
    dailyState.running = false;
    dailyState.nextAt = null;
  }
}

async function countdown(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const left = end - Date.now();
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    const s = Math.floor((left % 60000) / 1000);
    process.stdout.write(
      `\r${chalk.gray('⏳ Sleeping')} — next cycle in ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}   `
    );
    await sleep(1000);
  }
  process.stdout.write('\n');
}

async function menuTelegram() {
  const { input, confirm, select } = await prompts();
  header();
  const cur = tg.getConfig();
  console.log(`Current token : ${cur.token ? cur.token.slice(0, 10) + '...' : chalk.gray('(not set)')}`);
  console.log(`Current chatId: ${cur.chatId || chalk.gray('(not set)')}`);
  console.log('');
  console.log(chalk.gray('Cara dapat Bot Token: chat @BotFather, /newbot, copy token.'));
  console.log(chalk.gray('Cara dapat Chat ID  : chat ke bot kamu, lalu buka'));
  console.log(chalk.gray('  https://api.telegram.org/bot<TOKEN>/getUpdates'));
  console.log('');

  const action = await select({
    message: 'Pilih aksi:',
    choices: [
      { name: 'Setup / update credentials', value: 'setup' },
      { name: 'Send test message', value: 'test' },
      { name: 'Disable (clear credentials)', value: 'clear' },
      { name: 'Back', value: 'back' },
    ],
  });

  if (action === 'back') return;

  if (action === 'clear') {
    const ok = await confirm({ message: 'Clear Telegram credentials?', default: false });
    if (ok) {
      tg.saveCreds('', '');
      console.log(chalk.green('Cleared.'));
    }
  } else if (action === 'setup') {
    const token = await input({ message: 'Bot Token:', default: cur.token });
    const chatId = await input({ message: 'Chat ID:', default: cur.chatId });
    const r = await tg.testConnection(token, chatId);
    if (r.ok) {
      tg.saveCreds(token, chatId);
      console.log(chalk.green('✔ Connected & saved to .env'));
    } else {
      console.log(chalk.red('✖ Failed: ' + JSON.stringify(r.data || r.error || {})));
    }
  } else if (action === 'test') {
    if (!tg.isEnabled()) {
      console.log(chalk.red('Belum setup. Pilih "Setup" dulu.'));
    } else {
      const r = await tg.sendMessage('🧪 Test message from Arc Farm');
      console.log(r.ok ? chalk.green('✔ Sent') : chalk.red('✖ Failed: ' + JSON.stringify(r.data || {})));
    }
  }
  await pause();
}

async function pause() {
  const { input } = await prompts();
  await input({ message: chalk.gray('Tekan Enter untuk kembali ke menu...'), default: '' });
}

async function main() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    header();
    const { select } = await prompts();
    const choice = await select({
      message: 'Pilih menu:',
      choices: [
        { name: '📊  Check balance all wallets', value: 'balance' },
        { name: '🚀  Bridge all wallets (Sepolia → Arc)', value: 'bridge' },
        { name: '⚡  Resume bridge (mint only, pakai burn tx hash)', value: 'resume' },
        { name: '🔥  Start daily farming (auto loop 24h)', value: 'daily' },
        { name: '🔔  Telegram bot (setup / test)', value: 'tg' },
        { name: '❌  Exit', value: 'exit' },
      ],
      loop: false,
    });
    if (choice === 'exit') {
      console.log(chalk.gray('Bye.'));
      process.exit(0);
    }
    try {
      if (choice === 'balance') await menuBalance();
      else if (choice === 'bridge') await menuBridge();
      else if (choice === 'resume') await menuResume();
      else if (choice === 'daily') await menuDailyFarm();
      else if (choice === 'tg') await menuTelegram();
    } catch (e) {
      if (e && (e.name === 'ExitPromptError' || e.message?.includes('force closed'))) {
        console.log(chalk.gray('\nInterrupted.'));
        process.exit(0);
      }
      console.log(chalk.red('Menu error: ' + e.message));
      await pause();
    }
  }
}

process.on('SIGINT', () => {
  console.log(chalk.gray('\nStopped.'));
  process.exit(0);
});

// Jangan biarkan error socket/TLS transient (ECONNRESET dll) bikin crash process.
// Log ringkas ke stderr, biarkan loop farming lanjut / retry internal yg handle.
process.on('uncaughtException', (err) => {
  const transient = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'socket hang up'];
  const msg = err?.message || String(err);
  if (transient.some((p) => msg.includes(p))) {
    // silent: RPC/TG hiccup, biasanya sudah di-retry di level task
    return;
  }
  console.error(chalk.red('\n[uncaughtException] ' + msg));
});
process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  const transient = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'socket hang up'];
  if (transient.some((p) => msg.includes(p))) return;
  console.error(chalk.red('\n[unhandledRejection] ' + msg));
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
