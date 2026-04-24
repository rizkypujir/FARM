'use strict';
const { ethers } = require('ethers');
const { shortAddr, txUrl, log } = require('../utils');

// Minimal init code: mendeploy kontrak dengan runtime code berisi 1 byte STOP (0x00).
// Kontrak valid di-onchain (punya address & bytecode) tapi cuma STOP saat dipanggil.
// Ideal untuk farming deployment count dengan gas minimal.
//
// Layout init code:
//   PUSH1 0x01 PUSH1 0x0c PUSH1 0x00 CODECOPY   ; copy 1 byte dari offset 0x0c ke mem[0]
//   PUSH1 0x01 PUSH1 0x00 RETURN                ; return 1 byte dari mem[0]
//   STOP                                        ; runtime code (offset 0x0c)
const MINIMAL_INIT_CODE = '0x6001600c60003960016000f300';

async function deployMinimal(wallet) {
  // Tambahkan salt random supaya tiap deploy punya tx data unik (via extra data payload)
  const nonce = ethers.hexlify(ethers.randomBytes(4)).slice(2);
  const data = MINIMAL_INIT_CODE + nonce;
  const tx = await wallet.sendTransaction({ data });
  const rcpt = await tx.wait(1, Number(process.env.TX_TIMEOUT_MS || 90000));
  log(
    'tx:deploy',
    `${shortAddr(wallet.address)} deployed -> ${shortAddr(rcpt.contractAddress || '')}  ${txUrl(tx.hash)}`
  );
  return rcpt;
}

module.exports = { deployMinimal, MINIMAL_INIT_CODE };
