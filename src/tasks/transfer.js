'use strict';
const { ethers } = require('ethers');
const chain = require('../../config/chain');
const erc20Abi = require('../abi/erc20');
const { shortAddr, txUrl, log } = require('../utils');

function randomAddress() {
  return ethers.Wallet.createRandom().address;
}

const TX_TIMEOUT_MS = Number(process.env.TX_TIMEOUT_MS || 90000); // 90s default

async function transferToken(wallet, tokenKey, to, amount) {
  const token = chain.tokens[tokenKey];
  const c = new ethers.Contract(token.address, erc20Abi, wallet);
  const value = ethers.parseUnits(String(amount), token.decimals);
  const tx = await c.transfer(to, value);
  // wait(confirms, timeoutMs) — ethers v6: throw kalau tx gak confirmed dalam timeoutMs
  const rcpt = await tx.wait(1, TX_TIMEOUT_MS);
  log(
    `tx:${tokenKey}`,
    `${shortAddr(wallet.address)} -> ${shortAddr(to)}  ${amount} ${token.symbol}  ${txUrl(tx.hash)}  block=${rcpt.blockNumber}`
  );
  return rcpt;
}

async function selfTransferUsdc(wallet, amount) {
  return transferToken(wallet, 'USDC', wallet.address, amount);
}
async function selfTransferEurc(wallet, amount) {
  return transferToken(wallet, 'EURC', wallet.address, amount);
}
async function randomTransferUsdc(wallet, amount) {
  return transferToken(wallet, 'USDC', randomAddress(), amount);
}
async function randomTransferEurc(wallet, amount) {
  return transferToken(wallet, 'EURC', randomAddress(), amount);
}

module.exports = {
  transferToken,
  selfTransferUsdc,
  selfTransferEurc,
  randomTransferUsdc,
  randomTransferEurc,
  randomAddress,
};
