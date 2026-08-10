export type ProposalStatus = 'Open' | 'Executed' | 'Rejected';

export interface Proposal {
  id: bigint;
  title: string;
  amount: bigint;
  recipient: Uint8Array;
  deadline: bigint;
  quorum: bigint;
  yes: bigint;
  no: bigint;
  status: ProposalStatus;
  recipientsHex: string;
}

export interface DaoState {
  treasury: bigint;
  nextProposalId: bigint;
  membersCount: number;
  votesCast: number;
  proposals: Proposal[];
}

export const STATUS_OPEN = 0;
export const STATUS_EXECUTED = 1;
export const STATUS_REJECTED = 2;

export function statusToLabel(status: number): ProposalStatus {
  switch (status) {
    case STATUS_EXECUTED:
      return 'Executed';
    case STATUS_REJECTED:
      return 'Rejected';
    default:
      return 'Open';
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substr(i, 2), 16);
  }
  return bytes;
}

export function formatAmount(amount: bigint): string {
  return amount.toLocaleString();
}

export function governanceLabel(): string {
  return 'Proved without revealing your input';
}