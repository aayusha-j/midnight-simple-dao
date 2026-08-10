/**
 * CLI for interacting with a deployed Simple DAO contract.
 *
 *   npm run cli -- --network preview
 *
 * Privacy note: member secrets and ballot choices entered here are NEVER
 * persisted or logged — they are passed straight into the ZK circuit, used to
 * build the proof, and discarded.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { Buffer } from 'buffer';

// Midnight SDK imports
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateSeed, getDeployment } from './network.js';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet.js';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

// Must match the privateStateId used at deploy time.
const PRIVATE_STATE_ID = 'simpleDaoPrivateState';
const CONTRACT_NAME = 'simple-dao';

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateSeed(network);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', CONTRACT_NAME);

const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Contract not compiled! Run: npm run compile\n');
  process.exit(1);
}

const { Contract, ledger } = await import(pathToFileURL(contractPath).href);

const compiledContract = CompiledContract.make(CONTRACT_NAME, Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

// ─── Providers ─────────────────────────────────────────────────────────────────

async function createProviders(walletCtx: WalletContext) {
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'simple-dao-state',
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toHex(value: bigint | number): string {
  const n = BigInt(value);
  const hex = n.toString(16).padStart(2, '0');
  return hex.padStart(64, '0');
}

function parseProposalStatus(s: unknown): string {
  switch (String(s)) {
    case '0': return 'Open';
    case '1': return 'Executed';
    case '2': return 'Rejected';
    default: return String(s);
  }
}

interface ProposalView {
  id: number;
  title: string;
  amount: bigint;
  recipient: string;
  deadline: string;
  yes: number;
  no: number;
  status: string;
}

function listProposals(ledgerState: any): ProposalView[] {
  const map = ledgerState.proposals ?? new Map();
  const views: ProposalView[] = [];
  for (const [key, p] of map) {
    const id = typeof key === 'bigint' ? Number(key) : Number(key);
    views.push({
      id,
      title: String(p.title),
      amount: typeof p.amount === 'bigint' ? p.amount : BigInt(p.amount),
      recipient: bytesToHex(p.recipient),
      deadline: new Date(Number(p.deadline)).toISOString(),
      yes: Number(p.yes),
      no: Number(p.no),
      status: parseProposalStatus(p.status),
    });
  }
  views.sort((a, b) => a.id - b.id);
  return views;
}

function bytesToHex(b: Uint8Array): string {
  let out = '';
  for (const byte of b) out += byte.toString(16).padStart(2, '0');
  return out;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                Simple DAO — Midnight CLI               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const rl = createInterface({ input: stdin, output: stdout });

  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deploy on file for network ${network}. Run \`npm run deploy -- --network ${network}\` first.`);
    process.exit(1);
  }
  console.log(`  Contract: ${deployment.address}`);
  console.log(`  Network: ${network}\n`);

  try {
    console.log('  Connecting to wallet...');
    const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
    const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
    if (restoredCount > 0) {
      console.log(`  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync will resume from saved point.`);
    }

    console.log('  Syncing with network...');
    console.log('  ℹ  This may take a few minutes on public networks.\n');
    const syncStart = Date.now();
    const syncInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - syncStart) / 1000);
      process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
    }, 5000);
    const state = await walletCtx.wallet.waitForSyncedState();
    clearInterval(syncInterval);
    process.stdout.write('\r  ✓ Synced with network.                                      \n');

    await persistWalletState(network, walletCtx);
    const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

    if (balance === 0n && network !== 'undeployed' && networkConfig.faucet) {
      const address = walletCtx.unshieldedKeystore.getBech32Address();
      console.log('  ⚠ Wallet has no tNight. Fund it from the faucet to send transactions:');
      console.log(`     ${networkConfig.faucet}`);
      console.log(`     Wallet address: ${address}\n`);
    }

    console.log('  Connecting to contract...');
    const providers = await createProviders(walletCtx);

    const deployed: any = await findDeployedContract(providers, {
      compiledContract: compiledContract as any,
      contractAddress: deployment.address,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: {},
    });

    console.log('  ✅ Connected!\n');

    const readState = async () => {
      const contractState = await providers.publicDataProvider.queryContractState(deployment.address);
      if (!contractState) return undefined;
      return ledger(contractState.data);
    };

    let running = true;
    while (running) {
      console.log('─── Menu ───────────────────────────────────────────────────────');
      console.log('  1. Register as a member');
      console.log('  2. Submit a spending proposal');
      console.log('  3. Vote on a proposal (yes/no)');
      console.log('  4. Execute a proposal (after deadline)');
      console.log('  5. Show treasury + proposals (public state)');
      console.log('  6. Check wallet balance');
      console.log('  7. Exit\n');

      const choice = await rl.question('  Your choice: ');

      switch (choice.trim()) {
        case '1': {
          const secret = await rl.question('  Enter a secret credential (64-char hex, e.g. "aa..aa"): ');
          const hex = secret.trim().replace(/^0x/, '');
          if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
            console.log('\n  ❌ Secret must be 64 hexadecimal characters.\n');
            break;
          }
          console.log('\n  ⤴ Generating zero-knowledge proof...');
          try {
            const tx = await deployed.callTx.registerMember(Buffer.from(hex, 'hex'));
            console.log('  ✅ Proved without revealing your credential.');
            console.log('  ✅ Member registered.');
            console.log(`  Transaction ID: ${tx.public.txId}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '2': {
          const title = await rl.question('  Proposal title: ');
          const amount = await rl.question('  Amount (DAO units): ');
          const recipient = await rl.question('  Recipient (64-char hex): ');
          const days = await rl.question('  Voting period (days): ');
          const quorum = await rl.question('  Required yes-quorum (#votes): ');
          try {
            const amountN = BigInt(amount.trim() || '0');
            const recipientHex = recipient.trim().replace(/^0x/, '');
            const deadline = BigInt(Date.now() + Number(days.trim() || '1') * 86_400_000);
            const quorumN = BigInt(quorum.trim() || '1');
            if (amountN <= 0n) throw new Error('Amount must be > 0');
            if (!/^[0-9a-fA-F]{64}$/.test(recipientHex)) throw new Error('Recipient must be 64-char hex');
            if (quorumN <= 0n) throw new Error('Quorum must be >= 1');
            if (Number(days) <= 0) throw new Error('Voting period must be > 0 days');

            console.log('\n  ⤴ Generating zero-knowledge proof...');
            const tx = await deployed.callTx.submitProposal(
              title,
              amountN,
              Buffer.from(recipientHex, 'hex'),
              deadline,
              quorumN,
            );
            console.log('  ✅ Proposal submitted (proposal metadata is public by design).');
            console.log(`  Transaction ID: ${tx.public.txId}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '3': {
          const id = await rl.question('  Proposal id: ');
          const vote = await rl.question('  Vote (yes/no): ');
          const secret = await rl.question('  Your member secret (64-char hex): ');
          const voteChoice = vote.trim().toLowerCase();
          const hex = secret.trim().replace(/^0x/, '');
          if (voteChoice !== 'yes' && voteChoice !== 'no') {
            console.log('\n  ❌ Vote must be "yes" or "no".\n');
            break;
          }
          if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
            console.log('\n  ❌ Secret must be 64 hexadecimal characters.\n');
            break;
          }
          console.log('\n  ⤴ Generating zero-knowledge proof...');
          try {
            const tx = await deployed.callTx.vote(
              BigInt(id.trim()),
              voteChoice === 'yes',
              Buffer.from(hex, 'hex'),
            );
            console.log('  ✅ Proved without revealing how you voted.');
            console.log('  ✅ Vote recorded.');
            console.log(`  Transaction ID: ${tx.public.txId}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '4': {
          const id = await rl.question('  Proposal id: ');
          console.log('\n  ⤴ Generating zero-knowledge proof...');
          try {
            const tx = await deployed.callTx.executeProposal(BigInt(id.trim()));
            console.log('  ✅ Proposal finalised (auto-execute or reject).');
            console.log(`  Transaction ID: ${tx.public.txId}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '5': {
          const s = await readState();
          if (!s) {
            console.log('\n  No contract state found.\n');
            break;
          }
          console.log(`\n  Treasury: ${s.treasury.toString()} DAO units`);
          console.log(`  Members registered: ${s.members.size}`);
          const views = listProposals(s);
          if (views.length === 0) {
            console.log('  No proposals yet.\n');
          } else {
            console.log('  Proposals:');
            for (const v of views) {
              console.log(`   #${v.id} [${v.status}] ${v.title}`);
              console.log(`      amount: ${v.amount} | recipient: ${v.recipient.slice(0, 16)}…`);
              console.log(`      deadline: ${v.deadline} | yes: ${v.yes} | no: ${v.no}\n`);
            }
          }
          break;
        }

        case '6': {
          console.log('\n  Checking balance...');
          const currentState = await walletCtx.wallet.waitForSyncedState();
          const currentBalance = currentState.unshielded.balances[unshieldedToken().raw] ?? 0n;
          const dustBalance = currentState.dust.balance(new Date());
          console.log(`\n  tNight: ${currentBalance.toLocaleString()}`);
          console.log(`  DUST: ${dustBalance.toLocaleString()}\n`);
          break;
        }

        case '7':
          running = false;
          console.log('\n  👋 Goodbye!\n');
          break;

        default:
          console.log('\n  ❌ Invalid choice. Please enter 1-7.\n');
      }
    }

    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
  } finally {
    rl.close();
  }
}

main().catch(console.error);