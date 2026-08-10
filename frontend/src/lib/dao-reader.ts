import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { ledger } from '../../../contracts/managed/simple-dao/contract/index.js';
import { type Proposal, statusToLabel } from './dao-types';

const DEFAULT_INDEXER = 'https://indexer.preview.midnight.network/api/v4/graphql';
const DEFAULT_INDEXER_WS = 'wss://indexer.preview.midnight.network/api/v4/graphql/ws';
const DEFAULT_NETWORK = 'preview';

function ensureNetworkId(): void {
  try {
    getNetworkId();
  } catch {
    setNetworkId((import.meta.env.VITE_DAO_NETWORK_ID as string | undefined) ?? DEFAULT_NETWORK);
  }
}

export function createDaoReader(contractAddress: string) {
  ensureNetworkId();
  const provider = indexerPublicDataProvider(
    (import.meta.env.VITE_DAO_INDEXER_URL as string | undefined) ?? DEFAULT_INDEXER,
    (import.meta.env.VITE_DAO_INDEXER_WS_URL as string | undefined) ?? DEFAULT_INDEXER_WS,
  );

  const readState = async () => {
    const state = await provider.queryContractState(contractAddress);
    return state ? ledger(state.data) : null;
  };

  return {
    getProposals: async (): Promise<Proposal[]> => {
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
          recipientsHex: Array.from(raw.recipient, (b) => b.toString(16).padStart(2, '0')).join(''),
        });
      }
      return proposals.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    getTreasury: async (): Promise<bigint> => (await readState())?.treasury ?? 0n,
    getMemberCount: async (): Promise<number> => Number((await readState())?.members.size() ?? 0n),
  };
}

export function resolveDefaultContractAddress(): string {
  return (import.meta.env.VITE_DAO_CONTRACT_ADDRESS as string | undefined)?.trim() ?? '';
}