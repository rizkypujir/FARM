# Arc Testnet Farm

Multi-wallet bot untuk Arc Testnet (Circle stablecoin L1). Gas bayar pakai USDC.

## Setup

```bash
git clone https://github.com/rizkypujir/FARM.git
cd FARM
npm install
npm run compile
cp .env.example .env
```

Edit `.env` → isi `PRIVATE_KEYS`.

## Run

```bash
npm start
```

Menu:
- 📊 Balance
- 🚀 Bridge Sepolia → Arc
- ⚡ Resume bridge (pakai burn tx hash)
- 🔥 Daily farming (auto 24h loop)
- 🔔 Telegram notif

## VPS

```bash
screen -S farm
npm start
# Ctrl+A lalu D untuk detach
```

Masuk lagi: `screen -r farm`

## Tasks per wallet per cycle

Transfer USDC/EURC · Approve StableFX · Deploy ERC20/NFT · zkCodex (deploy/GM/counter)

## Env penting

```
PRIVATE_KEYS=0xabc,0xdef
RPC_URL=https://arc-testnet.g.alchemy.com/v2/KEY
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/KEY
```
