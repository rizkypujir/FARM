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

Edit `.env` → set `RPC_URL`, `SEPOLIA_RPC_URL` (+ `TG_*` optional).

## Wallet

**Pakai wallets.txt** (recommended, auto-loaded):
```bash
node scripts/generateWallets.js 50   # generate 50 PK baru
# atau paste PK sendiri, 1 baris per PK
```

**Atau pakai .env**:
```
PRIVATE_KEYS=0xabc,0xdef
```

## Run

```bash
npm start
```

Menu:
- Balance check
- Bridge Sepolia → Arc (parallel, auto MITM detect)
- Resume bridge (pakai burn tx hash)
- Daily farming (auto 24h loop)
- Telegram notif

## VPS

```bash
screen -S farm
npm start
# detach: Ctrl+A lalu D
# attach: screen -r farm
```

## Tasks per cycle

Transfer USDC/EURC · Approve StableFX · Deploy ERC20/NFT · zkCodex (deploy/GM/counter)

## Env penting

```
RPC_URL=https://arc-testnet.g.alchemy.com/v2/KEY
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/KEY
TX_PER_WALLET=10
PARALLEL_WALLETS=false
LOOP=false
```
