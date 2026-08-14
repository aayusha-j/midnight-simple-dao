# Simple DAO — Midnight Network

A governance system where token holders can submit proposals and vote on how to spend a shared treasury. Once a voting threshold (quorum) and deadline are met, approved proposals are automatically executed and funds are released — while every individual ballot stays private.

## Project Vision

Treasury governance today is all-or-nothing: either the books are fully public and individual votes leak, or everything hides behind a trusted party. Simple DAO shows a middle path enabled by Midnight's zero-knowledge circuits: the community can **audit everything that matters** (what is being proposed, how much, who is eligible to vote) while **no one can tell how any single member voted**. Votes are proven correct without revealing the ballot — a member's credential and their yes/no choice exist only inside a ZK proof and are discarded the moment it is submitted. This matters for real DAOs because vote-buying, coercion and retaliation all depend on voters being identifiable; privacy is what makes governance safe to participate in. Midnight's Compact language lets us put commitments and nullifiers on-chain while keeping the secrets that back them provably unrevealed.

## Smart Contract Deployment

- **Network:** Preview
- **Deployed contract address:** `816ffc6777b0ed3ffaed5fada2733eb9694902ece641b66eb4c43ce8b3b42369`
- **Deployer wallet address:** `mn_addr_preview1k9elxqmx6qwf34wqm29nzhrmavp7v50qn4scafv2778q8430zrrqhe238y`
## Key Features

- **Private membership.** A member registers with a 32-byte credential; only its `persistentHash` commitment is stored on-chain. The secret never touches the ledger.
- **Anonymous voting.** `vote()` proves the caller owns a registered credential and applies exactly one tally increment — without revealing which member voted or whether it was yes or no. An observer sees only an opaque nullifier (preventing double votes) and the aggregate yes/no counts.
- **Public, auditable proposals.** Titles, payout amounts, recipients, deadlines and quorums are public on-chain so the community can weigh each spending request.
- **Automatic execution.** Once the deadline passes, `executeProposal()` resolves every open proposal: it debits the treasury and marks the proposal `Executed` when `yes >= quorum && yes > no && treasury covers the amount`, otherwise `Rejected`.
- **Zero-knowledge proofs throughout.** Every private action is wrapped in a circuit and labeled *"Proved without revealing your input"* in the UI.
- **Live indexer reads.** The frontend reads contract state (treasury, members, proposals) directly from the Midnight indexer.
- **CLI + React dApp.** Drive the DAO from the terminal (`npm run cli`) or from the browser wallet UI.

## Future Scope

- **Coin-backed treasury.** Today the treasury is a `Uint<64>` ledger value; wire it to a real Midnight coin/FT so `executeProposal` performs an actual transfer to the recipient.
- **Vote-weighting.** Extend the voting circuit so ballots are weighted by the voter's token balance held at the proposal deadline.
- **Delegation & squads.** Add circuits for delegate voting and multi-sig execution of payouts.
- **Snapshot membership.** Freeze the eligible-member set at proposal creation time for fair, race-free quorums.
- **Mainnet path.** Migrate from Preview to Midnight mainnet with a formal audit of the compact circuits and key-management hardening.
- **Receipts & off-chain tally proofs.** Publish zk-proofs that the aggregate tally matches the sum of private votes for third-party verifiers.

## Tech Stack

- **Contract:** Compact (`pragma language_version 0.23`) compiled with the Midnight `compact` compiler.
- **Runtime/SDK:** `@midnight-ntwrk/compact-runtime`, `midnight-js-*` packages (contracts, indexer public-data provider, HTTP proof provider, node ZK-config provider, level private-state provider, network-id).
- **Tests:** Vitest — headless testkit driving the compiled JS circuits (no node/proof-server/Docker required).
- **Frontend:** React 18 + Vite 6 + TypeScript, using the Midnight DApp Connector API (`window.midnight`), the 1am-wallet adapter patterns, and the hosted Preview proof server.
- **Tooling:** npm, tsx, Node 22, Docker Compose (optional local devnet: `node :9944`, `indexer :8088`, `proof-server :6300`).

## Local Development

### 0. Prerequisites

- Node.js **22+** and npm 10+.
- `compact` compiler on your `PATH` (`compact --version`).
- (Preview deploys) a funded Preview wallet — see Deploy below.
- (Optional) Docker with the Midnight devnet images for a local `undeployed` network.

### 1. Install

```bash
npm install
npm --prefix frontend install
```

### 2. Compile the contract

```bash
npm run compile
```

Generates `contracts/managed/simple-dao/` (circuits + JS bindings). Artifacts are gitignored.

### 3. Run the headless tests

```bash
npm run test
```

9 tests covering circuit logic, the full proposal lifecycle (submit → vote → auto-execute), double-vote prevention, deadline enforcement, and — critically — that **private inputs are never exposed** in any ledger output or circuit result.

### 4. Optional local devnet (Docker)

```bash
npm run setup:devnet   # docker compose up -d --wait  (node, indexer, proof-server)
npm run setup          # fund genesis wallet, prepare DUST
```

### 5. Deploy to Preview

```bash
# 1) Fund the wallet first (0 tNIGHT to start):
npm run check-balance   # prints your wallet address + tNIGHT balance
#    → send tNIGHT to that address via
#      https://midnight-tmnight-preview.nethermind.dev/  (or /faucet.preview.midnight.network)
#      and wait for the transaction to confirm.

# 2) Point the hosted proof server at Preview (no local Docker needed):
export MIDNIGHT_PROOF_SERVER=https://proof-server.preview.midnight.network

# 3) Deploy (waits up to 10 min for funds if balance is still 0):
npm run deploy -- --network preview
```

On success the contract address is printed, saved to `.midnight-state.json`, and written into `frontend/.env.local` as `VITE_DAO_CONTRACT_ADDRESS=...`.

### 6. Run the CLI

```bash
npm run cli -- --network preview
```

Interactive menu: register as a member, submit a proposal, vote, execute (or reject) proposals, and print live on-chain state.

### 7. Run the React dApp

```bash
npm run frontend:dev      # dev server with HMR
npm run frontend:build    # typecheck + production build (zero errors)
```

Install the Midnight Wallet browser extension, connect to **Preview**, and interact with the deployed contract. Reads come from the indexer; writes are proven in your wallet and submitted on-chain.

### Hosting

`frontend/vercel.json` and `frontend/netlify.toml` (+ `public/_redirects`) provide SPA rewrites for Vercel and Netlify deploys.

## Privacy in plain English

Everything the DAO needs to be auditable is public: proposals, the treasury, member *commitments* (hashes) and vote *nullifiers*. Everything that would identify a person or their ballot is private: the 32-byte membership credential and the yes/no choice. Those secrets exist only inside a zero-knowledge proof, generated in your browser, used once, and discarded. The chain — and anyone watching it — learns *that* a registered member voted on proposal N and *that* the aggregate tally moved by one. It never learns *who* or *which way*.
