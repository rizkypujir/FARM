'use strict';
require('dotenv').config();

module.exports = {
  name: 'Arc Testnet',
  chainId: Number(process.env.CHAIN_ID || 5042002),
  rpcUrl: process.env.RPC_URL || 'https://arc-testnet.drpc.org',
  explorer: process.env.EXPLORER || 'https://testnet.arcscan.app',
  tokens: {
    // USDC adalah native gas token Arc
    USDC: {
      address: '0x3600000000000000000000000000000000000000',
      decimals: 6,
      symbol: 'USDC',
    },
    EURC: {
      address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
      decimals: 6,
      symbol: 'EURC',
    },
    USYC: {
      address: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C',
      decimals: 6,
      symbol: 'USYC',
    },
  },
  contracts: {
    stableFX: '0x867650F5eAe8df91445971f14d89fd84F0C9a9f8',
    multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
    create2Deployer: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },
};
