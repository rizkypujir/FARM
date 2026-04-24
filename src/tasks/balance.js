'use strict';
const { ethers } = require('ethers');
const chain = require('../../config/chain');
const erc20Abi = require('../abi/erc20');
const { getProvider } = require('../provider');
const { loadWallets } = require('../wallets');
const { shortAddr, log } = require('../utils');

async function balanceOf(wallet) {
  const provider = getProvider();
  const usdc = new ethers.Contract(chain.tokens.USDC.address, erc20Abi, provider);
  const eurc = new ethers.Contract(chain.tokens.EURC.address, erc20Abi, provider);

  const [nativeBal, usdcBal, eurcBal] = await Promise.all([
    provider.getBalance(wallet.address),
    usdc.balanceOf(wallet.address).catch(() => 0n),
    eurc.balanceOf(wallet.address).catch(() => 0n),
  ]);

  return {
    address: wallet.address,
    native: ethers.formatEther(nativeBal),
    usdc: ethers.formatUnits(usdcBal, chain.tokens.USDC.decimals),
    eurc: ethers.formatUnits(eurcBal, chain.tokens.EURC.decimals),
  };
}

async function main() {
  const wallets = loadWallets();
  log('balance', `Checking ${wallets.length} wallet(s) on ${chain.name}`);
  for (const w of wallets) {
    try {
      const b = await balanceOf(w);
      log(
        'balance',
        `${shortAddr(b.address)}  native=${b.native}  USDC=${b.usdc}  EURC=${b.eurc}`
      );
    } catch (e) {
      log('balance', `${shortAddr(w.address)}  ERROR: ${e.message}`);
    }
  }
}

module.exports = { balanceOf };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
