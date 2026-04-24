'use strict';
/**
 * Standalone test script untuk Curve di Arc testnet.
 *
 * Context Arc testnet:
 *   - Native gas token = USDC (18 decimals di level chain)
 *   - WUSDC (0x911b4000...) = wrapped native, 18 decimals (untuk AMM)
 *   - EURC (0x89B50855...) = token ERC20 terpisah, 6 decimals
 *   - Pool "bbq" (0x74d80eE4...) = WUSDC/EURC stableswap-ng
 *     - coins[0] = EURC
 *     - coins[1] = WUSDC
 *
 * Usage:
 *   node scripts/testCurve.js balance
 *   node scripts/testCurve.js swap            # direct pool: wrap USDC->WUSDC lalu pool.exchange
 *   node scripts/testCurve.js swap-router     # via router: native USDC -> EURC (1 tx)
 *   node scripts/testCurve.js swap-back       # direct pool: EURC -> WUSDC (auto unwrap)
 *   node scripts/testCurve.js swap-back-router # via router: EURC -> native USDC (1 tx)
 *   node scripts/testCurve.js addlp           # add LP: WUSDC + EURC
 *   node scripts/testCurve.js removelp        # remove all LP
 *   node scripts/testCurve.js unwrap          # WUSDC -> native USDC
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// ====== KONFIGURASI ======
const ARC_RPC = process.env.RPC_URL || 'https://arc-testnet.drpc.org';

// Token addresses
const NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const WUSDC = '0x911b4000D3422F482F4062a913885f7b035382Df'; // 18 dec
const EURC  = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a'; // 6 dec

// Curve
const ROUTER = '0xFF5Cb29241F002fFeD2eAa224e3e996D24A6E8d1';
const POOL   = '0x74d80eE400D3026FDd2520265cC98300710b25D4';
const EURC_INDEX  = 0;
const WUSDC_INDEX = 1;

// ====== ABI ======
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

// WETH-style wrapper
const WUSDC_ABI = [
  ...ERC20_ABI,
  'function deposit() payable',
  'function withdraw(uint256)',
];

const POOL_ABI = [
  'function coins(uint256) view returns (address)',
  'function balances(uint256) view returns (uint256)',
  'function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)',
  'function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)',
  'function add_liquidity(uint256[] amounts, uint256 min_mint_amount) returns (uint256)',
  'function remove_liquidity(uint256 burn_amount, uint256[] min_amounts) returns (uint256[])',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
];

const ROUTER_ABI = [
  'function exchange(address[11] _route, uint256[4][5] _swap_params, uint256 _amount, uint256 _min_dy) payable returns (uint256)',
];

// ====== SETUP ======
function loadTestWallet() {
  const fp = path.join(__dirname, '..', 'test-wallet.txt');
  if (!fs.existsSync(fp)) throw new Error('test-wallet.txt tidak ada.');
  const pk = fs.readFileSync(fp, 'utf8').trim();
  if (!pk) throw new Error('test-wallet.txt kosong.');
  const provider = new ethers.JsonRpcProvider(ARC_RPC, { name: 'arc-testnet', chainId: 5042002 });
  return new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk, provider);
}

async function ensureApprove(wallet, token, spender, amount) {
  const c = new ethers.Contract(token, ERC20_ABI, wallet);
  const allow = await c.allowance(wallet.address, spender);
  if (allow >= amount) return;
  console.log(`  approve ${token.slice(0, 10)}... -> ${spender.slice(0, 10)}...`);
  const tx = await c.approve(spender, ethers.MaxUint256);
  await tx.wait();
}

// ====== COMMANDS ======
async function balance() {
  const w = loadTestWallet();
  console.log(`\nWallet: ${w.address}\n`);

  const nat = await w.provider.getBalance(w.address);
  console.log(`  Native USDC: ${ethers.formatEther(nat)}`);

  const wusdc = new ethers.Contract(WUSDC, ERC20_ABI, w.provider);
  const eurc  = new ethers.Contract(EURC,  ERC20_ABI, w.provider);
  const [wb, eb] = await Promise.all([wusdc.balanceOf(w.address), eurc.balanceOf(w.address)]);
  console.log(`  WUSDC:       ${ethers.formatUnits(wb, 18)}`);
  console.log(`  EURC:        ${ethers.formatUnits(eb, 6)}`);

  const pool = new ethers.Contract(POOL, POOL_ABI, w.provider);
  const [c0, c1, b0, b1, lp] = await Promise.all([
    pool.coins(0), pool.coins(1), pool.balances(0), pool.balances(1), pool.balanceOf(w.address),
  ]);
  console.log(`\nPool ${POOL}:`);
  console.log(`  coins[0]=${c0} (EURC)  bal=${ethers.formatUnits(b0, 6)}`);
  console.log(`  coins[1]=${c1} (WUSDC) bal=${ethers.formatUnits(b1, 18)}`);
  console.log(`  LP kamu: ${ethers.formatUnits(lp, 18)}`);
}

// Cara 1: direct pool — wrap USDC manual, lalu pool.exchange
async function swap() {
  const w = loadTestWallet();
  const amount = ethers.parseUnits('1', 18); // 1 USDC native

  console.log(`\n[Direct pool] Swap 1 USDC -> EURC`);

  // 1. wrap native USDC -> WUSDC (kalau saldo WUSDC belum cukup)
  const wusdc = new ethers.Contract(WUSDC, WUSDC_ABI, w);
  let wbal = await wusdc.balanceOf(w.address);
  if (wbal < amount) {
    const need = amount - wbal;
    console.log(`  wrap ${ethers.formatEther(need)} USDC -> WUSDC`);
    const tx = await wusdc.deposit({ value: need });
    console.log(`    tx: ${tx.hash}`);
    await tx.wait();
  }

  // 2. approve pool
  await ensureApprove(w, WUSDC, POOL, amount);

  // 3. exchange
  const pool = new ethers.Contract(POOL, POOL_ABI, w);
  const expected = await pool.get_dy(WUSDC_INDEX, EURC_INDEX, amount);
  const minOut = (expected * 99n) / 100n;
  console.log(`  expected: ${ethers.formatUnits(expected, 6)} EURC  (min: ${ethers.formatUnits(minOut, 6)})`);

  const tx = await pool.exchange(WUSDC_INDEX, EURC_INDEX, amount, minOut);
  console.log(`  tx: https://testnet.arcscan.app/tx/${tx.hash}`);
  const r = await tx.wait();
  console.log(`  ok block ${r.blockNumber}`);
}

// Cara 2: via router (replay struktur tx reference)
async function swapViaRouter() {
  const w = loadTestWallet();
  const amount = ethers.parseUnits('1', 18);

  console.log(`\n[Router] Swap 1 native USDC -> EURC`);

  const route = [
    NATIVE_SENTINEL, // in: native
    WUSDC,           // wrap step output
    WUSDC,           // pool input
    POOL,            // pool
    EURC,            // pool output
    ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress,
    ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress,
  ];
  // [i, j, swap_type, pool_type]
  //   step 0: wrap native -> WUSDC (swap_type=8)
  //   step 1: WUSDC(i=1) -> EURC(j=0), stableswap-ng (swap_type=1, pool_type=10)
  const swap_params = [
    [0, 0, 8, 0],
    [1, 0, 1, 10],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];

  // estimate via pool.get_dy (pool masuk WUSDC)
  const pool = new ethers.Contract(POOL, POOL_ABI, w.provider);
  const expected = await pool.get_dy(WUSDC_INDEX, EURC_INDEX, amount);
  const minOut = (expected * 99n) / 100n;
  console.log(`  expected: ${ethers.formatUnits(expected, 6)} EURC  (min: ${ethers.formatUnits(minOut, 6)})`);

  const router = new ethers.Contract(ROUTER, ROUTER_ABI, w);
  const est = await router.exchange.estimateGas(route, swap_params, amount, minOut, { value: amount });
  const gasLimit = (est * 130n) / 100n; // +30% buffer
  const tx = await router.exchange(route, swap_params, amount, minOut, { value: amount, gasLimit });
  console.log(`  tx: https://testnet.arcscan.app/tx/${tx.hash}`);
  const r = await tx.wait();
  console.log(`  ok block ${r.blockNumber}`);
}

// Cara 1 reverse: direct pool — EURC -> WUSDC, lalu auto-unwrap -> native USDC
async function swapBack() {
  const w = loadTestWallet();
  const amount = ethers.parseUnits('0.5', 6); // 0.5 EURC

  console.log(`\n[Direct pool] Swap 0.5 EURC -> USDC (native)`);

  // 1. approve EURC ke pool
  await ensureApprove(w, EURC, POOL, amount);

  // 2. exchange EURC -> WUSDC
  const pool = new ethers.Contract(POOL, POOL_ABI, w);
  const expected = await pool.get_dy(EURC_INDEX, WUSDC_INDEX, amount);
  const minOut = (expected * 99n) / 100n;
  console.log(`  expected: ${ethers.formatUnits(expected, 18)} WUSDC  (min: ${ethers.formatUnits(minOut, 18)})`);

  const tx = await pool.exchange(EURC_INDEX, WUSDC_INDEX, amount, minOut);
  console.log(`  tx: https://testnet.arcscan.app/tx/${tx.hash}`);
  const r = await tx.wait();
  console.log(`  ok block ${r.blockNumber}`);

  // 3. auto-unwrap WUSDC yang baru didapat -> native
  const wusdc = new ethers.Contract(WUSDC, WUSDC_ABI, w);
  const wbal = await wusdc.balanceOf(w.address);
  if (wbal > 0n) {
    console.log(`  auto-unwrap ${ethers.formatEther(wbal)} WUSDC -> native`);
    const tx2 = await wusdc.withdraw(wbal);
    console.log(`  tx: https://testnet.arcscan.app/tx/${tx2.hash}`);
    await tx2.wait();
  }
}

// Cara 2 reverse: via router — EURC -> native USDC dalam 1 tx
async function swapBackViaRouter() {
  const w = loadTestWallet();
  const amount = ethers.parseUnits('0.5', 6);

  console.log(`\n[Router] Swap 0.5 EURC -> native USDC`);

  await ensureApprove(w, EURC, ROUTER, amount);

  // Route kebalikan: EURC -> pool -> WUSDC -> unwrap -> native
  const route = [
    EURC,
    POOL,
    WUSDC,
    WUSDC,            // input ke step unwrap
    NATIVE_SENTINEL,  // output native
    ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress,
    ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress,
  ];
  // step 0: EURC(i=0) -> WUSDC(j=1) via pool, stableswap-ng (type=1, pool_type=10)
  // step 1: WUSDC -> native, unwrap (swap_type=8)
  const swap_params = [
    [0, 1, 1, 10],
    [0, 0, 8, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];

  const pool = new ethers.Contract(POOL, POOL_ABI, w.provider);
  const expected = await pool.get_dy(EURC_INDEX, WUSDC_INDEX, amount);
  const minOut = (expected * 99n) / 100n;
  console.log(`  expected: ${ethers.formatUnits(expected, 18)} USDC  (min: ${ethers.formatUnits(minOut, 18)})`);

  const router = new ethers.Contract(ROUTER, ROUTER_ABI, w);
  const est = await router.exchange.estimateGas(route, swap_params, amount, minOut);
  const gasLimit = (est * 130n) / 100n; // +30% buffer
  const tx = await router.exchange(route, swap_params, amount, minOut, { gasLimit });
  console.log(`  tx: https://testnet.arcscan.app/tx/${tx.hash}`);
  const r = await tx.wait();
  console.log(`  ok block ${r.blockNumber}`);
}

async function addLp() {
  const w = loadTestWallet();
  const amtWusdc = ethers.parseUnits('0.5', 18);
  const amtEurc  = ethers.parseUnits('0.5', 6);

  console.log(`\nAdd LP: 0.5 WUSDC + 0.5 EURC`);

  // Pastikan WUSDC cukup (wrap kalau perlu)
  const wusdc = new ethers.Contract(WUSDC, WUSDC_ABI, w);
  const wbal = await wusdc.balanceOf(w.address);
  if (wbal < amtWusdc) {
    const need = amtWusdc - wbal;
    console.log(`  wrap ${ethers.formatEther(need)} USDC -> WUSDC`);
    const tx = await wusdc.deposit({ value: need });
    await tx.wait();
  }

  await ensureApprove(w, WUSDC, POOL, amtWusdc);
  await ensureApprove(w, EURC,  POOL, amtEurc);

  const pool = new ethers.Contract(POOL, POOL_ABI, w);
  const amounts = [0n, 0n];
  amounts[EURC_INDEX]  = amtEurc;
  amounts[WUSDC_INDEX] = amtWusdc;

  const tx = await pool.add_liquidity(amounts, 0n);
  console.log(`  tx: https://testnet.arcscan.app/tx/${tx.hash}`);
  const r = await tx.wait();
  console.log(`  ok block ${r.blockNumber}`);
}

async function removeLp() {
  const w = loadTestWallet();
  const pool = new ethers.Contract(POOL, POOL_ABI, w);
  const lp = await pool.balanceOf(w.address);
  if (lp === 0n) {
    console.log('LP = 0, skip.');
    return;
  }
  console.log(`\nRemove all LP (${ethers.formatUnits(lp, 18)})`);

  const tx = await pool.remove_liquidity(lp, [0n, 0n]);
  console.log(`  tx: https://testnet.arcscan.app/tx/${tx.hash}`);
  const r = await tx.wait();
  console.log(`  ok block ${r.blockNumber}`);
}

async function unwrap() {
  const w = loadTestWallet();
  const wusdc = new ethers.Contract(WUSDC, WUSDC_ABI, w);
  const bal = await wusdc.balanceOf(w.address);
  if (bal === 0n) {
    console.log('WUSDC = 0, skip.');
    return;
  }
  console.log(`\nUnwrap ${ethers.formatEther(bal)} WUSDC -> native USDC`);
  const tx = await wusdc.withdraw(bal);
  console.log(`  tx: https://testnet.arcscan.app/tx/${tx.hash}`);
  const r = await tx.wait();
  console.log(`  ok block ${r.blockNumber}`);
}

// ====== MAIN ======
const cmd = (process.argv[2] || 'balance').toLowerCase();
const actions = {
  balance,
  swap,
  'swap-router': swapViaRouter,
  'swap-back': swapBack,
  'swap-back-router': swapBackViaRouter,
  addlp: addLp,
  removelp: removeLp,
  unwrap,
};
if (!actions[cmd]) {
  console.error(`Unknown command: ${cmd}`);
  console.error(`Available: ${Object.keys(actions).join(', ')}`);
  process.exit(1);
}

actions[cmd]()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nERROR:', e.shortMessage || e.message);
    if (e.data) console.error('  data:', e.data);
    process.exit(1);
  });
