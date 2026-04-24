'use strict';
const { ethers } = require('ethers');
const { shortAddr, txUrl, log } = require('../utils');

// ===== zkCodex Arc Testnet contracts =====
// Sumber: https://zkcodex.com/onchain/
const ZKCODEX = {
  deployer: '0xECF3365559FfE5fdBE1953df0A01244e234e4453',
  gm: '0x1290B4f2a419A316467b580a088453a233e9ADCc',
  counter: '0xfcF1E3e7890559c56013457e7073791ed27060a1',
};

// Fee yang di-attach ke setiap call (dari capture tx resmi)
const FEE_DEPLOY = ethers.parseEther('0.1');   // 0.1 USDC (native) per deploy
const FEE_COUNTER = ethers.parseEther('0.01'); // 0.01 USDC per increment

// ===== Helpers =====
async function sendRaw(wallet, { to, data, value = 0n, label }) {
  const tx = await wallet.sendTransaction({ to, data, value });
  const rcpt = await tx.wait();
  log(
    `tx:${label}`,
    `${shortAddr(wallet.address)} -> ${shortAddr(to)}  ${txUrl(tx.hash)}  block=${rcpt.blockNumber}`
  );
  return rcpt;
}

// ===== Raw hex data dari capture tx zkCodex (persis match kontrak) =====
// Strings/params sama untuk semua wallet — tetap valid karena tiap call
// deploy instance baru per sender.

// 1. Deploy Simple: selector 0x2c39c058 + bytes32(0)
const DATA_DEPLOY_SIMPLE =
  '0x2c39c0580000000000000000000000000000000000000000000000000000000000000000';

// 2. Deploy Token: selector 0x2efc6c04
//    args: (string name="zkCodex Token Deployer", string symbol="ZKCODEX", uint256 supply=1M*1e18, uint256 extra=0)
//    Dibangun ulang dari ABI encoding (clean, aligned 32-byte slots).
const DATA_DEPLOY_TOKEN =
  '0x2efc6c04' +
  '0000000000000000000000000000000000000000000000000000000000000080' +
  '00000000000000000000000000000000000000000000000000000000000000c0' +
  '00000000000000000000000000000000000000000000d3c21bcecceda1000000' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000016' +
  '7a6b436f64657820546f6b656e204465706c6f79657200000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000007' +
  '5a4b434f44455800000000000000000000000000000000000000000000000000';

// 3. Deploy NFT: selector 0x2f2fcb42
//    args: (string name="zkCodex NFT Deployer", string symbol="ZKCODEX", uint256 maxSupply=10, uint256 extra=0)
const DATA_DEPLOY_NFT =
  '0x2f2fcb42' +
  '0000000000000000000000000000000000000000000000000000000000000080' +
  '00000000000000000000000000000000000000000000000000000000000000c0' +
  '000000000000000000000000000000000000000000000000000000000000000a' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000014' +
  '7a6b436f646578204e4654204465706c6f796572000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000007' +
  '5a4b434f44455800000000000000000000000000000000000000000000000000';

// 4. GM: selector 0x8cb09282 + "GM!"
const DATA_GM =
  '0x8cb09282' +
  '0000000000000000000000000000000000000000000000000000000000000020' +
  '0000000000000000000000000000000000000000000000000000000000000003' +
  '474d210000000000000000000000000000000000000000000000000000000000';

// normalisasi: hilangkan newlines/spasi yg mungkin ikut copy
function normHex(s) {
  return s.replace(/\s+/g, '');
}

async function zkDeploySimple(wallet) {
  return sendRaw(wallet, {
    to: ZKCODEX.deployer,
    data: normHex(DATA_DEPLOY_SIMPLE),
    value: FEE_DEPLOY,
    label: 'zkDeploySimple',
  });
}

async function zkDeployToken(wallet) {
  return sendRaw(wallet, {
    to: ZKCODEX.deployer,
    data: normHex(DATA_DEPLOY_TOKEN),
    value: FEE_DEPLOY,
    label: 'zkDeployToken',
  });
}

async function zkDeployNft(wallet) {
  return sendRaw(wallet, {
    to: ZKCODEX.deployer,
    data: normHex(DATA_DEPLOY_NFT),
    value: FEE_DEPLOY,
    label: 'zkDeployNft',
  });
}

async function zkGm(wallet) {
  return sendRaw(wallet, {
    to: ZKCODEX.gm,
    data: normHex(DATA_GM),
    value: 0n,
    label: 'zkGm',
  });
}

// ===== 5. Counter (terus menerus) =====
// selector 0x5b34b966 tanpa argumen, value 0.01 USDC
async function zkCounterOnce(wallet) {
  return sendRaw(wallet, {
    to: ZKCODEX.counter,
    data: '0x5b34b966',
    value: FEE_COUNTER,
    label: 'zkCounter',
  });
}

async function zkCounterMany(wallet, count = 3) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(await zkCounterOnce(wallet));
  }
  return results;
}

module.exports = {
  ZKCODEX,
  zkDeploySimple,
  zkDeployToken,
  zkDeployNft,
  zkGm,
  zkCounterOnce,
  zkCounterMany,
};
