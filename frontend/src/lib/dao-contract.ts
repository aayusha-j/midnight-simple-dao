import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import {
  Binding,
  Proof,
  SignatureEnabled,
  Transaction,
  type FinalizedTransaction,
  type TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';

import { Contract as SimpleDaoContract, ledger, type Ledger } from '../../../contracts/managed/simple-dao/contract/index.js';
import { FetchZkConfigProvider } from './fetch-zk-config';
import { InMemoryPrivateStateProvider } from './in-memory-pstate';
import { type Proposal, statusToLabel } from './dao-types';

export type DaoCircuitKeys = 'registerMember' | 'submitProposal' | 'vote' | 'executeProposal';

const PRIVATE_STATE_ID = 'simple-dao-frontend-private-state';
const COMPATIBLE_CONNECTOR_API_VERSION = /^4\./;

export interface DaoDeployment {
  contractAddress: string;
  networkId: string;
  unshieldedAddress: string;
  callTx: {
    registerMember(secret: Uint8Array): Promise<{ public: { txId: string } }>;
    submitProposal(
      title: string,
      amount: bigint,
      recipient: Uint8Array,
      deadline: bigint,
      quorum: bigint,
    ): Promise<{ public: { txId: string } }>;
    vote(proposalId: bigint, choice: boolean, secret: Uint8Array): Promise<{ public: { txId: string } }>;
    executeProposal(proposalId: bigint): Promise<{ public: { txId: string } }>;
  };
  reads: {
    getProposals(): Promise<Proposal[]>;
    getTreasury(): Promise<bigint>;
    getMemberCount(): Promise<number>;
    isMember(commitment: Uint8Array): Promise<boolean>;
  };
}

let cachedDeployment: DaoDeployment | null = null;

function getFirstCompatibleWallet(): InitialAPI | undefined {
  const injected = (window as unknown as Record<string, unknown>).midnight as Record<string, unknown> | undefined;
  if (!injected) return undefined;
  return Object.values(injected).find(
    (wallet): wallet is InitialAPI =>
      !!wallet &&
      typeof wallet === 'object' &&
      'apiVersion' in wallet &&
      COMPATIBLE_CONNECTOR_API_VERSION.test((wallet as InitialAPI).apiVersion),
  );
}

function waitForWallet(timeoutMs = 6000): Promise<InitialAPI> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      const wallet = getFirstCompatibleWallet();
      if (wallet) {
        resolve(wallet);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        reject(
          new Error(
            'Could not find a compatible Midnight Wallet (API "4.x"). Install the Midnight Wallet browser extension and refresh this page.',
          ),
        );
        return;
      }
      setTimeout(poll, 150);
    };
    poll();
  });
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.substr(i, 2), 16);
  }
  return out;
}

/**
 * Connects to the wallet, builds all Midnight providers and locates the
 * deployed Simple DAO contract at `contractAddress`. Subsequent calls reuse the
 * same providers (contract calls are single-call `callTx` sessions, so no
 * private state needs to be persisted between actions).
 *
 * PRIVACY NOTE: member credentials and ballot choices are one-shot circuit
 * inputs. They are never stored in the in-memory private state provider, never
 * persisted, and never logged.
 */
export async function connectAndFindContract(contractAddress: string): Promise<DaoDeployment> {
  if (cachedDeployment) {
    return cachedDeployment;
  }

  const wallet = await waitForWallet();
  const connected = await wallet.connect((import.meta.env.VITE_DAO_NETWORK_ID as string | undefined) ?? 'preview');
  const config = await connected.getConfiguration();
  setNetworkId(config.networkId);

  const { unshieldedAddress } = await connected.getUnshieldedAddress();
  const shielded = await connected.getShieldedAddresses();

  const zkConfigProvider = new FetchZkConfigProvider<DaoCircuitKeys>(`${window.location.origin}/zk/simple-dao`);
  const proofProvider = httpClientProofProvider(
    config.proverServerUri ?? (import.meta.env.VITE_DAO_PROOF_SERVER as string | undefined) ?? '',
    zkConfigProvider,
  );
  const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);

  const providers = {
    privateStateProvider: new InMemoryPrivateStateProvider<string, Record<string, never>>(),
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider: {
      getCoinPublicKey: () => shielded.shieldedCoinPublicKey,
      getEncryptionPublicKey: () => shielded.shieldedEncryptionPublicKey,
      balanceTx: async (tx: unknown) => {
        const receive = await connected.balanceUnsealedTransaction(toHex((tx as { serialize(): Uint8Array }).serialize()));
        return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
          'signature',
          'proof',
          'binding',
          fromHex(receive.tx),
        ) as FinalizedTransaction;
      },
    },
    midnightProvider: {
      submitTx: async (tx: FinalizedTransaction): Promise<TransactionId> => {
        await connected.submitTransaction(toHex(tx.serialize()));
        return tx.identifiers()[0];
      },
    },
  };

  const compiledContract = CompiledContract.make(
    'SimpleDAO',
    // The engine-generated Contract class shape differs slightly from compact-js's
    // `Contract` type parameter defaults; numeric context is all that matters here.
    SimpleDaoContract as unknown as never,
  ).pipe(CompiledContract.withVacantWitnesses);

  // `findDeployedContract` returns a richly typed contract wrapper; we narrow it
  // through an `any` boundary into the small surface the UI uses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deployed = (await findDeployedContract(providers as any, {
    compiledContract: compiledContract as never,
    contractAddress,
    initialPrivateState: {},
    privateStateId: PRIVATE_STATE_ID,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as any;

  const readState = async (): Promise<Ledger | null> => {
    const state = await publicDataProvider.queryContractState(contractAddress);
    return state ? ledger(state.data) : null;
  };

  const deployment: DaoDeployment = {
    contractAddress,
    networkId: config.networkId,
    unshieldedAddress,
    callTx: {
      registerMember: (secret) => deployed.callTx.registerMember(secret),
      submitProposal: (title, amount, recipient, deadline, quorum) =>
        deployed.callTx.submitProposal(title, amount, recipient, deadline, quorum),
      vote: (proposalId, choice, secret) => deployed.callTx.vote(proposalId, choice, secret),
      executeProposal: (proposalId) => deployed.callTx.executeProposal(proposalId),
    },
    reads: {
      getProposals: async () => {
        const parsed = await readState();
        if (!parsed) return [];
        const proposals: Proposal[] = [];
        for (const [id, raw] of parsed.proposals) {
          proposals.push({
            id,
            title: raw.title,
            amount: raw.amount,
            recipient: raw.recipient,
            deadline: raw.deadline,
            quorum: raw.quorum,
            yes: raw.yes,
            no: raw.no,
            status: statusToLabel(raw.status),
            recipientsHex: toHex(raw.recipient),
          });
        }
        return proposals.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      },
      getTreasury: async () => (await readState())?.treasury ?? 0n,
      getMemberCount: async () => Number((await readState())?.members.size() ?? 0n),
      isMember: async (commitment) => (await readState())?.members.member(commitment) ?? false,
    },
  };

  cachedDeployment = deployment;
  return deployment;
}

export function getCachedDeployment(): DaoDeployment | null {
  return cachedDeployment;
}