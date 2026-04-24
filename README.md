# Arc Testnet Farm

Multi-wallet on-chain activity generator untuk **Arc Testnet** (Circle's stablecoin-native L1).
Gas dibayar dalam **USDC**, bukan ETH.

## Fitur

- **Interactive menu** — `npm start` → menu cantik dengan arrow keys
- **Multi-wallet** (PK list via `.env` atau `wallets.txt`)
- **Full task sequence per wallet** (sequential, aman nonce):
  1. Self transfer USDC + EURC
  2. Random transfer USDC + EURC
  3. Approve USDC + EURC ke StableFX
  4. Deploy basic contract (STOP runtime)
  5. Deploy real ERC20 (SimpleERC20)
  6. Deploy real NFT + mint (SimpleNFT)
- **Daily auto-loop** — set sekali, jalan tiap 24 jam otomatis
- **CCTP bridge** Sepolia → Arc (built-in)
- **Telegram notifications** — cuma milestone (start, tiap wallet selesai, cycle done)
- **Single-line spinner** — tidak spam terminal, log detail di `logs/farm-YYYYMMDD.log`

## Setup

```bash
cd arc-testnet-farm
npm install
cp .env.example .env
```

Isi `.env`:
- `PRIVATE_KEYS=0xabc,0xdef` **atau** buat `wallets.txt` (1 PK per baris)
- Atur `TX_PER_WALLET`, `ENABLED_TASKS`, `DELAY_*`, dll

## Funding Wallet

Setiap wallet butuh **USDC** untuk bayar gas. Claim dari [Circle Faucet](https://faucet.circle.com/).
Untuk farming paralel volume besar, bridge USDC dari Sepolia via CCTP/Gateway.

## Jalankan

```powershell
npm install
npm run compile   # sekali saja, compile ERC20 + NFT
npm start         # buka interactive menu
```

Menu:
```
📊  Check balance all wallets
🌉  Bridge all wallets (Sepolia → Arc)
🚜  Start daily farming (auto loop 24h)
🤖  Telegram bot (setup / test)
🚪  Exit
```

### Power-user commands (bypass menu)
```powershell
npm run balance        # cek balance
npm run bridge         # bridge sekali (pakai BRIDGE_AMOUNT_USDC dari .env)
npm run deploy:erc20   # deploy ERC20 untuk semua wallet
npm run deploy:nft     # deploy NFT + mint untuk semua wallet
```

## Chain Info

- Chain ID: `5042002`
- RPC default: `https://arc-testnet.drpc.org`
- Explorer: `https://testnet.arcscan.app`
- USDC (gas): `0x3600000000000000000000000000000000000000`
- EURC: `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`
- StableFX: `0x867650F5eAe8df91445971f14d89fd84F0C9a9f8`

## Telegram Notifications

Setup via menu `🤖 Telegram bot`:
1. Chat ke `@BotFather` di Telegram, `/newbot`, dapat **Bot Token**
2. Chat apa saja ke bot yang baru kamu buat
3. Buka `https://api.telegram.org/bot<TOKEN>/getUpdates` → cari `chat.id`
4. Masukkan Token + Chat ID via menu, auto-saved ke `.env`

Notifikasi yang dikirim:
- 🚀 Cycle started
- 🏁 Cycle done (total ok/fail/duration)
- ⏳ Next cycle scheduled time
- 🌉 Bridge started / finished

## Daily Farming di VPS (24/7)

Pakai PM2 supaya tetap jalan walau SSH disconnect:

```bash
npm install -g pm2
pm2 start src/menu.js --name arc-farm --no-autorestart
# masuk ke menu via:
pm2 attach arc-farm
# setup daily farm → detach (Ctrl+C sekali, tidak akan kill process) dengan:
# tekan Ctrl+B lalu D
```

Atau lebih simpel: buat script non-interactive yang langsung jalan daily loop.

## Catatan

- **StableFX swap** tidak diimplementasi — Circle menyatakan StableFX adalah **permissioned institutional-only**. `approveUsdcFx` tetap valid sebagai interaksi on-chain.
- Task deploy ERC20/NFT pakai kontrak **real** (SimpleERC20/SimpleNFT di `contracts/`) kalau sudah `npm run compile`. Kalau belum, fallback ke kontrak minimal.
- **JANGAN commit** `wallets.txt` / `.env`. Sudah di `.gitignore`.
- Log detail tiap tx ke `logs/farm-YYYYMMDD.log` — terminal cuma spinner 1 baris.

## Bridge USDC Sepolia -> Arc (CCTP v2)

Untuk auto-fund wallet Arc dari Sepolia. Prasyarat: wallet punya USDC Sepolia + sedikit ETH Sepolia untuk gas burn.

```powershell
# set BRIDGE_AMOUNT_USDC di .env, lalu:
npm run bridge
```

Alur: approve USDC -> `depositForBurn` di Sepolia -> polling attestation dari Circle IRIS -> `receiveMessage` di Arc (mint USDC). Fast Transfer (~sub-menit).

Contract (CCTP v2 testnet):
- Sepolia USDC: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
- TokenMessengerV2 (kedua chain): `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`
- MessageTransmitterV2 (kedua chain): `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`
- Domain: Sepolia=`0`, Arc=`26`
- Iris API: `https://iris-api-sandbox.circle.com`

## Deploy ERC20 / NFT Sungguhan

```powershell
npm install            # sekali saja (termasuk hardhat)
npm run compile        # compile SimpleERC20.sol + SimpleNFT.sol
npm run deploy:erc20   # deploy ERC20 random untuk semua wallet
npm run deploy:nft     # deploy NFT + mint #1 untuk semua wallet
```

Kalau `npm run farm` dijalankan dan artifact sudah ada, task `deployErc20`/`deployNft` otomatis pakai kontrak real. Kalau belum dicompile, otomatis fallback ke deploy kontrak minimal (STOP) supaya farming tetap jalan.

## Roadmap

- [x] Bridge USDC via CCTP dari Sepolia
- [x] Compile & deploy ERC20/ERC721 sungguhan via Hardhat
- [ ] Swap USDC↔EURC via StableFX (**permissioned/institutional only** — tidak tersedia untuk retail)
- [ ] Logging ke file + CSV report per wallet
