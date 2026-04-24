'use strict';
const { ethers } = require('ethers');
const { loadArtifact, hasArtifact } = require('../artifacts');
const { deployMinimal } = require('./deploy');
const { shortAddr, txUrl, log, randomName } = require('../utils');

async function deployErc20Real(wallet) {
  if (!hasArtifact('SimpleERC20')) {
    log('tx:deployErc20', 'artifact belum ada -> fallback deployMinimal. Jalankan "npm run compile" untuk deploy ERC20 real.');
    return deployMinimal(wallet);
  }
  const { abi, bytecode } = loadArtifact('SimpleERC20');
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);

  const name = `Farm${randomName('T')}`;
  const symbol = randomName('FT').slice(0, 6);
  const decimals = 18;
  const supply = ethers.parseUnits('1000000', 18);

  const contract = await factory.deploy(name, symbol, decimals, supply);
  const deployTx = contract.deploymentTransaction();
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  log(
    'tx:deployErc20',
    `${shortAddr(wallet.address)} deploy ${symbol} (${name}) -> ${shortAddr(addr)}  ${txUrl(deployTx.hash)}`
  );
  return { contract, address: addr, hash: deployTx.hash };
}

async function main() {
  const { loadWallets } = require('../wallets');
  const wallets = loadWallets();
  for (const w of wallets) {
    try {
      await deployErc20Real(w);
    } catch (e) {
      log('tx:deployErc20', `ERR ${shortAddr(w.address)}: ${e.message}`);
    }
  }
}

module.exports = { deployErc20Real };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
