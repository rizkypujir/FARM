'use strict';
require('dotenv').config();
const { ethers } = require('ethers');
const { Agent } = require('undici');
const { loadPrivateKeys } = require('../wallets');
const { log, shortAddr, sleep } = require('../utils');

// Custom dispatcher untuk IRIS: skip TLS verify.
// Alasan: pada sebagian sistem (jam/clock skew, trust store outdated, environment kantor)
// sertifikat iris-api-sandbox.circle.com bisa terlihat expired/invalid padahal valid.
// Ini endpoint public attestation Circle—aman untuk bypass verify.
const IRIS_DISPATCHER = new Agent({
  connect: { rejectUnauthorized: false },
});

// Circle CCTP V2 (testnet / sandbox)
const CCTP = {
  sepolia: {
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    rpc: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    domain: 0,
    explorer: 'https://sepolia.etherscan.io',
  },
  arc: {
    name: 'Arc Testnet',
    chainId: 5042002,
    rpc: process.env.RPC_URL || 'https://arc-testnet.drpc.org',
    usdc: '0x3600000000000000000000000000000000000000',
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    domain: 26,
    explorer: 'https://testnet.arcscan.app',
  },
};

const IRIS_API = 'https://iris-api-sandbox.circle.com';

const ERC20_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const TOKEN_MESSENGER_V2_ABI = [
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)',
];

const MESSAGE_TRANSMITTER_V2_ABI = [
  'function receiveMessage(bytes message, bytes attestation)',
];

function addressToBytes32(addr) {
  const clean = addr.toLowerCase().replace(/^0x/, '');
  return '0x' + '0'.repeat(24) + clean;
}

async function approveIfNeeded(wallet, token, spender, amount) {
  const erc20 = new ethers.Contract(token, ERC20_ABI, wallet);
  const cur = await erc20.allowance(wallet.address, spender);
  if (cur >= amount) {
    log('bridge', `allowance cukup (${cur})`);
    return null;
  }
  const tx = await erc20.approve(spender, ethers.MaxUint256);
  log('bridge', `approve USDC -> ${shortAddr(spender)}  tx=${tx.hash}`);
  const rcpt = await tx.wait();
  return rcpt;
}

async function burnOnSource(wallet, amountRaw, destAddress) {
  const src = CCTP.sepolia;
  const dst = CCTP.arc;
  const tm = new ethers.Contract(src.tokenMessenger, TOKEN_MESSENGER_V2_ABI, wallet);

  const mintRecipient = addressToBytes32(destAddress);
  const destinationCaller = '0x' + '0'.repeat(64); // allow any caller
  const maxFee = amountRaw / 2000n > 0n ? amountRaw / 2000n : 1n; // ~0.05%
  const minFinalityThreshold = 1000; // Fast Transfer

  log(
    'bridge',
    `burn ${amountRaw} on ${src.name} -> domain=${dst.domain}  recipient=${shortAddr(destAddress)}  maxFee=${maxFee}`
  );
  const tx = await tm.depositForBurn(
    amountRaw,
    dst.domain,
    mintRecipient,
    src.usdc,
    destinationCaller,
    maxFee,
    minFinalityThreshold
  );
  log('bridge', `burn tx: ${src.explorer}/tx/${tx.hash}`);
  const rcpt = await tx.wait();
  return rcpt.hash;
}

async function fetchAttestation(srcDomain, txHash) {
  const url = `${IRIS_API}/v2/messages/${srcDomain}?transactionHash=${txHash}`;
  const POLL_MS = Number(process.env.BRIDGE_POLL_MS || 2000);
  const TIMEOUT_MS = Number(process.env.BRIDGE_TIMEOUT_MS || 300000); // 5 menit default
  log('bridge', `polling attestation (timeout ${TIMEOUT_MS / 1000}s)`);
  const t0 = Date.now();
  let lastStatus = '';
  let mitmDetected = false;
  while (Date.now() - t0 < TIMEOUT_MS) {
    try {
      const resp = await fetch(url, { dispatcher: IRIS_DISPATCHER });
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('json')) {
        // Bukan JSON — kemungkinan ISP intercept (captive portal / walled garden).
        if (!mitmDetected) {
          const body = (await resp.text()).slice(0, 200);
          throw new Error(
            `IRIS response bukan JSON (content-type=${ct}). Kemungkinan koneksi internet kamu di-intercept ISP (Telkomsel "Internet Baik", kuota habis, atau filter DNS). ` +
              `Body preview: ${body.replace(/\s+/g, ' ')}`
          );
        }
      }
      if (resp.status === 404) {
        if (lastStatus !== '404') {
          log('bridge', 'iris: tx belum terindex (404) — nunggu...');
          lastStatus = '404';
        }
        await sleep(POLL_MS);
        continue;
      }
      if (!resp.ok) {
        await sleep(POLL_MS);
        continue;
      }
      const data = await resp.json();
      const msg = data?.messages?.[0];
      if (msg?.status === 'complete' && msg?.attestation && msg?.message) {
        log('bridge', `attestation ready (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        return msg;
      }
      const stat = msg?.status || 'pending';
      if (stat !== lastStatus) {
        log('bridge', `attestation status=${stat} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        lastStatus = stat;
      }
      await sleep(POLL_MS);
    } catch (e) {
      // Kalau sudah terdeteksi MITM, langsung throw (jangan loop polling)
      if (e.message?.includes('IRIS response bukan JSON') || e.message?.includes('di-intercept ISP')) {
        throw e;
      }
      await sleep(POLL_MS);
    }
  }
  throw new Error(
    `Attestation timeout (${TIMEOUT_MS / 1000}s). Tx: ${txHash}. ` +
      `Cek https://sepolia.etherscan.io/tx/${txHash}`
  );
}

async function mintOnDest(wallet, attestation) {
  const dst = CCTP.arc;
  const mt = new ethers.Contract(dst.messageTransmitter, MESSAGE_TRANSMITTER_V2_ABI, wallet);
  const tx = await mt.receiveMessage(attestation.message, attestation.attestation);
  log('bridge', `mint tx: ${dst.explorer}/tx/${tx.hash}`);
  const rcpt = await tx.wait();
  return rcpt.hash;
}

// Minimal ETH Sepolia yang harus dimiliki wallet (buffer ~2x typical gas).
// ~0.0005 ETH cukup untuk ~10 burn. Kalau kurang, skip wallet.
const MIN_ETH_SEPOLIA = ethers.parseEther(process.env.MIN_ETH_SEPOLIA || '0.0005');

async function preflightCheck(srcWallet, src, amountRaw) {
  const [ethBal, usdcBal] = await Promise.all([
    srcWallet.provider.getBalance(srcWallet.address),
    new ethers.Contract(src.usdc, ERC20_ABI, srcWallet.provider).balanceOf(srcWallet.address),
  ]);

  if (ethBal < MIN_ETH_SEPOLIA) {
    throw new Error(
      `ETH Sepolia tidak cukup untuk gas. Balance=${ethers.formatEther(ethBal)} ETH, ` +
        `minimum=${ethers.formatEther(MIN_ETH_SEPOLIA)} ETH. ` +
        `Claim di https://sepoliafaucet.com/ atau https://www.alchemy.com/faucets/ethereum-sepolia`
    );
  }
  if (usdcBal < amountRaw) {
    throw new Error(
      `USDC Sepolia tidak cukup. Balance=${ethers.formatUnits(usdcBal, 6)}, ` +
        `butuh=${ethers.formatUnits(amountRaw, 6)}. Claim di https://faucet.circle.com/`
    );
  }
  log(
    'bridge',
    `preflight ok  eth=${ethers.formatEther(ethBal)}  usdc=${ethers.formatUnits(usdcBal, 6)}`
  );
}

async function bridgeOne(pk, amountUsdc, destAddress) {
  const src = CCTP.sepolia;
  const dst = CCTP.arc;
  const srcProvider = new ethers.JsonRpcProvider(src.rpc, { name: src.name, chainId: src.chainId });
  const dstProvider = new ethers.JsonRpcProvider(dst.rpc, { name: dst.name, chainId: dst.chainId });
  const key = pk.startsWith('0x') ? pk : '0x' + pk;
  const srcWallet = new ethers.Wallet(key, srcProvider);
  const dstWallet = new ethers.Wallet(key, dstProvider);
  const recipient = destAddress || srcWallet.address;

  log('bridge', `==> ${shortAddr(srcWallet.address)} bridge ${amountUsdc} USDC Sepolia -> Arc (to ${shortAddr(recipient)})`);

  const amountRaw = ethers.parseUnits(String(amountUsdc), 6);

  // 0. pre-flight: pastikan ETH & USDC Sepolia cukup
  await preflightCheck(srcWallet, src, amountRaw);

  // 1. approve
  await approveIfNeeded(srcWallet, src.usdc, src.tokenMessenger, amountRaw);

  // 2. burn
  const burnHash = await burnOnSource(srcWallet, amountRaw, recipient);

  // 3. attestation (dengan timeout)
  const att = await fetchAttestation(src.domain, burnHash);

  // 4. mint di Arc
  const mintHash = await mintOnDest(dstWallet, att);

  log('bridge', `DONE ${shortAddr(srcWallet.address)}  burn=${burnHash}  mint=${mintHash}`);
  return { burnHash, mintHash };
}

async function main() {
  const pks = loadPrivateKeys();
  if (!pks.length) throw new Error('Tidak ada PRIVATE_KEYS / wallets.txt');

  const amount = process.env.BRIDGE_AMOUNT_USDC || '1';
  const dest = process.env.BRIDGE_DEST_ADDRESS || null; // default: self

  for (const pk of pks) {
    try {
      await bridgeOne(pk, amount, dest);
    } catch (e) {
      log('bridge', `ERR: ${e.shortMessage || e.message}`);
    }
  }
}

// ===== Resume bridge =====
// Kalau burn di Sepolia sudah confirmed tapi mint belum jalan (misal koneksi putus,
// ISP intercept, dll), pakai ini untuk lanjutin dari attestation -> mint saja.
// Hanya butuh burn tx hash + wallet yang punya sedikit USDC di Arc untuk gas mint.
async function resumeBridge(pk, burnTxHash) {
  const src = CCTP.sepolia;
  const dst = CCTP.arc;
  const dstProvider = new ethers.JsonRpcProvider(dst.rpc, { name: dst.name, chainId: dst.chainId });
  const key = pk.startsWith('0x') ? pk : '0x' + pk;
  const dstWallet = new ethers.Wallet(key, dstProvider);

  log('bridge', `==> RESUME ${shortAddr(dstWallet.address)}  burn=${burnTxHash}`);

  // 1. ambil attestation (pastikan burn tx udah final di Sepolia)
  const att = await fetchAttestation(src.domain, burnTxHash);

  // 2. mint di Arc
  const mintHash = await mintOnDest(dstWallet, att);

  log('bridge', `RESUME DONE  mint=${mintHash}`);
  return { mintHash };
}

module.exports = { bridgeOne, resumeBridge, CCTP };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
