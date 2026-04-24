'use strict';
/**
 * Standalone script untuk test interaksi Curve di Arc testnet.
 * Terpisah dari bot utama — kalau rugi/salah address, cuma test wallet kena.
 *
 * Cara pakai:
 *   1. Isi test-wallet.txt dengan 1 PK
 *   2. Fund wallet itu: ETH Sepolia + bridge USDC ke Arc, claim EURC juga
 *   3. Cek balance:
 *        node scripts/testCurve.js balance
 *   4. Cari pool address via UI Curve:
 *        - Buka https://www.curve.finance/dex/arc/
 *        - Connect wallet (pakai test wallet di MetaMask)
 *        - Swap 0.1 USDC → EURC (atau buka pool list)
 *        - Inspect tx di arcscan: https://testnet.arcscan.app/
 *        - Cari address pool yang dipanggil (biasanya implement Curve pool interface)
 *   5. Edit file ini, isi POOL_ADDRESS + indeks token (i/j)
 *   6. Jalankan:
 *        node scripts/testCurve.js swap        # swap 0.1 USDC → EURC
 *        node scripts/testCurve.js addlp       # add liquidity 0.1 USDC + 0.1 EURC
 *        node scripts/testCurve.js removelp    # remove all LP
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// ====== KONFIGURASI ======
const ARC_RPC = process.env.RPC_URL || 'https://arc-testnet.drpc.org';

// Token Arc testnet (dari config/chain.js)
const chain = require('../config/chain');
const USDC = chain.tokens.USDC.address;
const EURC = chain.tokens.EURC.address;

// TODO: isi setelah cari dari UI Curve Arc testnet
// Curve pool biasanya StableSwapNG (2-token pool USDC/EURC)
const POOL_ADDRESS = process.env.CURVE_POOL || '0x0000000000000000000000000000000000000000';
// Index token dalam pool: biasanya 0=USDC, 1=EURC (verifikasi via coins(0) & coins(1))
const USDC_INDEX = 0;
const EURC_INDEX = 1;

// ====== ABI ======
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// Curve StableSwapNG ABI (sederhana)
const CURVE_POOL_ABI = [
  'function coins(uint256) view returns (address)',
  'function balances(uint256) view returns (uint256)',
  'function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)',
  'function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)',
  'function add_liquidity(uint256[] amounts, uint256 min_mint_amount) returns (uint256)',
  'function remove_liquidity(uint256 burn_amount, uint256[] min_amounts) returns (uint256[])',
  'function balanceOf(address) view returns (uint256)', // LP token
  'function totalSupply() view returns (uint256)',
];

// ====== SETUP ======
function loadTestWallet() {
  const fp = path.join(__dirname, '..', 'test-wallet.txt');
  if (!fs.existsSync(fp)) throw new Error('test-wallet.txt tidak ada. Generate dulu.');
  const pk = fs.readFileSync(fp, 'utf8').trim();
  if (!pk) throw new Error('test-wallet.txt kosong.');
  const provider = new ethers.JsonRpcProvider(ARC_RPC, { name: 'arc-testnet', chainId: 5042002 });
  return new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk, provider);
}

async function balance() {
  const w = loadTestWallet();
  console.log(`\nWallet: ${w.address}\n`);

  const usdc = new ethers.Contract(USDC, ERC20_ABI, w.provider);
  const eurc = new ethers.Contract(EURC, ERC20_ABI, w.provider);
  const [u, e] = await Promise.all([usdc.balanceOf(w.address), eurc.balanceOf(w.address)]);
  console.log(`  USDC: ${ethers.formatUnits(u, 6)}`);
  console.log(`  EURC: ${ethers.formatUnits(e, 6)}`);

  if (POOL_ADDRESS !== '0x0000000000000000000000000000000000000000') {
    const pool = new ethers.Contract(POOL_ADDRESS, CURVE_POOL_ABI, w.provider);
    try {
      const [c0, c1, b0, b1, lp] = await Promise.all([
        pool.coins(0),
        pool.coins(1),
        pool.balances(0),
        pool.balances(1),
        pool.balanceOf(w.address),
      ]);
      console.log(`\nPool ${POOL_ADDRESS}:`);
      console.log(`  coins[0]=${c0}  balance=${ethers.formatUnits(b0, 6)}`);
      console.log(`  coins[1]=${c1}  balance=${ethers.formatUnits(b1, 6)}`);
      console.log(`  LP token kamu: ${ethers.formatUnits(lp, 18)}`);
    } catch (e) {
      console.log(`  Pool error: ${e.shortMessage || e.message}`);
      console.log(`  (Pool ABI mungkin berbeda — cek contract di arcscan dulu)`);
    }
  } else {
    console.log(`\n⚠️  POOL_ADDRESS belum di-set. Edit scripts/testCurve.js atau set env CURVE_POOL.`);
  }
}

async function ensureApprove(wallet, token, spender, amount) {
  const c = new ethers.Contract(token, ERC20_ABI, wallet);
  const allow = await c.allowance(wallet.address, spender);
  if (allow >= amount) return;
  console.log(`  approve ${token} -> ${spender}`);
  const tx = await c.approve(spender, ethers.MaxUint256);
  await tx.wait();
}

async function swap() {
  if (POOL_ADDRESS === '0x0000000000000000000000000000000000000000') {
    throw new Error('POOL_ADDRESS belum di-set. Edit script atau env CURVE_POOL.');
  }
  const w = loadTestWallet();
  const amt = ethers.parseUnits('0.1', 6); // 0.1 USDC
  console.log(`\nSwap 0.1 USDC → EURC via pool ${POOL_ADDRESS}`);

  await ensureApprove(w, USDC, POOL_ADDRESS, amt);

  const pool = new ethers.Contract(POOL_ADDRESS, CURVE_POOL_ABI, w);
  const expectedOut = await pool.get_dy(USDC_INDEX, EURC_INDEX, amt);
  const minOut = (expectedOut * 99n) / 100n; // 1% slippage
  console.log(`  expected out: ${ethers.formatUnits(expectedOut, 6)} EURC  (min: ${ethers.formatUnits(minOut, 6)})`);

  const tx = await pool.exchange(USDC_INDEX, EURC_INDEX, amt, minOut);
  console.log(`  tx: https://testnet.arcscan.app/tx/${tx.hash}`);
  const rcpt = await tx.wait();
  console.log(`  ✔ block ${rcpt.blockNumber}`);
}

async function addLp() {
  if (POOL_ADDRESS === '0x0000000000000000000000000000000000000000') {
    throw new Error('POOL_ADDRESS belum di-set.');
  }
  const w = loadTestWallet();
  const amt = ethers.parseUnits('0.1', 6);
  console.log(`\nAdd LP: 0.1 USDC + 0.1 EURC`);

  await ensureApprove(w, USDC, POOL_ADDRESS, amt);
  await ensureApprove(w, EURC, POOL_ADDRESS, amt);

  const pool = new ethers.Contract(POOL_ADDRESS, CURVE_POOL_ABI, w);
  const amounts = [0n, 0n];
  amounts[USDC_INDEX] = amt;
  amounts[EURC_INDEX] = amt;

  const tx = await pool.add_liquidity(amounts, 0n);
  console.log(`  tx: https://testnet.arcscan.app/tx/${tx.hash}`);
  const rcpt = await tx.wait();
  console.log(`  ✔ block ${rcpt.blockNumber}`);
}

async function removeLp() {
  if (POOL_ADDRESS === '0x0000000000000000000000000000000000000000') {
    throw new Error('POOL_ADDRESS belum di-set.');
  }
  const w = loadTestWallet();
  const pool = new ethers.Contract(POOL_ADDRESS, CURVE_POOL_ABI, w);
  const lp = await pool.balanceOf(w.address);
  if (lp === 0n) {
    console.log('LP kamu 0, skip.');
    return;
  }
  console.log(`\nRemove all LP (${ethers.formatUnits(lp, 18)})`);

  const tx = await pool.remove_liquidity(lp, [0n, 0n]);
  console.log(`  tx: https://testnet.arcscan.app/tx/${tx.hash}`);
  const rcpt = await tx.wait();
  console.log(`  ✔ block ${rcpt.blockNumber}`);
}

// ====== MAIN ======
const cmd = (process.argv[2] || 'balance').toLowerCase();
const actions = { balance, swap, addlp: addLp, removelp: removeLp };
if (!actions[cmd]) {
  console.error(`Unknown command: ${cmd}`);
  console.error(`Available: ${Object.keys(actions).join(', ')}`);
  process.exit(1);
}

actions[cmd]()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌ ERROR:', e.shortMessage || e.message);
    if (e.data) console.error('  data:', e.data);
    process.exit(1);
  });
