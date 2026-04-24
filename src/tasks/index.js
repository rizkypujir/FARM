'use strict';
require('dotenv').config();
const transfer = require('./transfer');
const approve = require('./approve');
const deploy = require('./deploy');
const { deployErc20Real } = require('./deployErc20Real');
const { deployNftReal } = require('./deployNftReal');

const SELF_USDC = process.env.SELF_TX_AMOUNT_USDC || '0.001';
const SELF_EURC = process.env.SELF_TX_AMOUNT_EURC || '0.001';

const TASKS = {
  selfTransferUsdc: {
    name: 'selfTransferUsdc',
    run: (w) => transfer.selfTransferUsdc(w, SELF_USDC),
  },
  selfTransferEurc: {
    name: 'selfTransferEurc',
    run: (w) => transfer.selfTransferEurc(w, SELF_EURC),
  },
  randomTransferUsdc: {
    name: 'randomTransferUsdc',
    run: (w) => transfer.randomTransferUsdc(w, SELF_USDC),
  },
  randomTransferEurc: {
    name: 'randomTransferEurc',
    run: (w) => transfer.randomTransferEurc(w, SELF_EURC),
  },
  approveUsdcFx: {
    name: 'approveUsdcFx',
    run: (w) => approve.approveUsdcFx(w),
  },
  approveEurcFx: {
    name: 'approveEurcFx',
    run: (w) => approve.approveEurcFx(w),
  },
  deployErc20: {
    name: 'deployErc20',
    // auto pakai real artifact kalau sudah dicompile; kalau belum fallback minimal
    run: (w) => deployErc20Real(w),
  },
  deployNft: {
    name: 'deployNft',
    run: (w) => deployNftReal(w),
  },
  deployMinimal: {
    name: 'deployMinimal',
    run: (w) => deploy.deployMinimal(w),
  },
  mintNft: {
    // placeholder: cuma self-transfer USDC kecil supaya tx count tetap naik
    name: 'mintNft',
    run: (w) => transfer.selfTransferUsdc(w, SELF_USDC),
  },
};

function resolveEnabled() {
  const raw = (process.env.ENABLED_TASKS || '').trim();
  if (!raw) return Object.values(TASKS);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((k) => TASKS[k])
    .filter(Boolean);
}

module.exports = { TASKS, resolveEnabled };
