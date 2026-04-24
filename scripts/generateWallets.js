'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const COUNT = Number(process.argv[2] || 50);
const OUT_FILE = path.resolve(__dirname, '..', process.argv[3] || 'wallets.txt');
const ADDR_FILE = OUT_FILE.replace(/\.txt$/, '.addresses.txt');

if (fs.existsSync(OUT_FILE)) {
  console.error(`❌ ${OUT_FILE} sudah ada. Rename/hapus dulu kalau mau overwrite.`);
  process.exit(1);
}

console.log(`Generating ${COUNT} wallets...`);

const lines = [];
const addrLines = [];
for (let i = 0; i < COUNT; i++) {
  const w = ethers.Wallet.createRandom();
  lines.push(w.privateKey);
  addrLines.push(`${i + 1}. ${w.address}`);
}

fs.writeFileSync(OUT_FILE, lines.join('\n') + '\n');
fs.writeFileSync(ADDR_FILE, addrLines.join('\n') + '\n');

console.log(`✔ ${COUNT} wallet ter-generate.`);
console.log(`  PK list      : ${OUT_FILE}`);
console.log(`  Address list : ${ADDR_FILE}`);
console.log('');
console.log('⚠️  JANGAN commit wallets.txt. Sudah di .gitignore.');
console.log('');
console.log('Preview 3 wallet pertama:');
for (let i = 0; i < Math.min(3, COUNT); i++) {
  console.log(`  ${i + 1}. ${addrLines[i].split(' ')[1]}`);
}
