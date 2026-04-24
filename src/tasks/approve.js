'use strict';
const { ethers } = require('ethers');
const chain = require('../../config/chain');
const erc20Abi = require('../abi/erc20');
const { shortAddr, txUrl, log, randInt } = require('../utils');

async function approveToken(wallet, tokenKey, spender, amount) {
  const token = chain.tokens[tokenKey];
  const c = new ethers.Contract(token.address, erc20Abi, wallet);
  const value = amount === 'max'
    ? ethers.MaxUint256
    : ethers.parseUnits(String(amount), token.decimals);
  const tx = await c.approve(spender, value);
  const rcpt = await tx.wait(1, Number(process.env.TX_TIMEOUT_MS || 90000));
  log(
    `tx:approve`,
    `${shortAddr(wallet.address)} approve ${token.symbol} spender=${shortAddr(spender)}  ${txUrl(tx.hash)}`
  );
  return rcpt;
}

async function approveUsdcFx(wallet) {
  const amt = (randInt(1, 50) / 10).toFixed(2); // 0.1 - 5.0
  return approveToken(wallet, 'USDC', chain.contracts.stableFX, amt);
}
async function approveEurcFx(wallet) {
  const amt = (randInt(1, 50) / 10).toFixed(2);
  return approveToken(wallet, 'EURC', chain.contracts.stableFX, amt);
}

module.exports = { approveToken, approveUsdcFx, approveEurcFx };
