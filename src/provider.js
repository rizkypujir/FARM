'use strict';
const { ethers } = require('ethers');
const chain = require('../config/chain');

let _provider;
function getProvider() {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(chain.rpcUrl, {
      name: chain.name,
      chainId: chain.chainId,
    });
  }
  return _provider;
}

function makeWallet(pk) {
  const key = pk.startsWith('0x') ? pk : '0x' + pk;
  return new ethers.Wallet(key, getProvider());
}

module.exports = { getProvider, makeWallet };
