import { describe, it, expect } from 'vitest';
import { Contract, ledger } from '../contracts/index.js';
import {
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
} from '@midnight-ntwrk/compact-runtime';

// ─────────────────────────────────────────────────────────────────────────────
// Headless tests for the Simple DAO contract.
//
// These run the compiled JS circuits directly — no node, no proof server, no
// Docker. Block time is fully controlled via the `time` (secondsSinceEpoch)
// argument of createCircuitContext, so deadline behaviour is deterministic.
//
// PRIVACY TEST: the last describe block proves that the private secret
// credentials and the individual ballot choices NEVER appear in any public
// ledger output or circuit result — only commitments and nullifiers do.
// ─────────────────────────────────────────────────────────────────────────────

type CircuitName = 'registerMember' | 'submitProposal' | 'vote' | 'executeProposal';

const coinPublicKey = '00'.repeat(32);
const BASE_TIME_S = 1_000_000; // fixed block time (seconds since epoch)

function deploy(seedTreasury: bigint) {
  const contract = new Contract({});
  const init = contract.initialState(
    createConstructorContext(undefined, coinPublicKey),
    seedTreasury,
  );
  return {
    contract,
    state: (init.currentContractState as unknown as { data: unknown }).data,
  };
}

function run(
  contract: Contract,
  state: unknown,
  circuit: CircuitName,
  args: unknown[],
  timeS: number = BASE_TIME_S,
) {
  const ctx = createCircuitContext(
    dummyContractAddress(),
    coinPublicKey,
    state as never,
    undefined,
    undefined,
    undefined,
    timeS,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = (contract.circuits[circuit] as any)(ctx, ...args);
  return res;
}

function afterState(res: ReturnType<typeof run>) {
  return res.context.currentQueryContext.state.state;
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function randomSecret(seed: number): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = (seed + i * 7) % 256;
  }
  return out;
}

function proposalArgs(title: string, amount: bigint, deadlineS: number, quorum: bigint) {
  return [title, amount, new Uint8Array(32).fill(0xab), BigInt(deadlineS), quorum];
}

// Walks any JSON-ish structure (objects, arrays, Uint8Array, bigint, …) and
// returns every byte string it contains as hex.
function collectHex(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (v == null) return;
    if (v instanceof Uint8Array) {
      out.push(toHex(v));
      return;
    }
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') return;
    if (t === 'bigint') return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (t === 'object') {
      for (const k of Object.keys(v as object)) {
        walk((v as Record<string, unknown>)[k]);
      }
      return;
    }
  };
  walk(value);
  return out;
}

describe('Simple DAO — circuit logic (headless)', () => {
  it('registerMember stores a commitment, never the raw secret', () => {
    const { contract, state } = deploy(10_000n);
    const secret = randomSecret(1);

    const after = afterState(run(contract, state, 'registerMember', [secret]));

    const l = ledger(after);
    expect(l.members.size()).toBe(1n);

    const stored = [...l.members][0];
    expect(toHex(stored)).not.toBe(toHex(secret));
    expect(l.members.member(secret)).toBe(false);
  });

  it('submitProposal rejects non-positive amounts and zero quorum', () => {
    const { contract, state } = deploy(10_000n);
    expect(() =>
      run(contract, state, 'submitProposal', proposalArgs('Free money', 0n, BASE_TIME_S + 100, 1n)),
    ).toThrow(/Amount/);
    expect(() =>
      run(contract, state, 'submitProposal', proposalArgs('No quorum', 5n, BASE_TIME_S + 100, 0n)),
    ).toThrow(/Quorum/);
  });

  it('submitProposal rejects a past deadline', () => {
    const { contract, state } = deploy(10_000n);
    expect(() =>
      run(contract, state, 'submitProposal', proposalArgs('Old', 5n, BASE_TIME_S - 100, 1n)),
    ).toThrow(/Deadline/);
  });
});

describe('Simple DAO — state transitions (full lifecycle)', () => {
  it('submits a proposal, votes yes, auto-executes and debits the treasury', () => {
    const TREASURY = 10_000n;
    const { contract, state } = deploy(TREASURY);

    const secretA = randomSecret(11);
    const secretB = randomSecret(22);
    let s = afterState(run(contract, state, 'registerMember', [secretA]));
    s = afterState(run(contract, s, 'registerMember', [secretB]));
    expect(ledger(s).members.size()).toBe(2n);

    const deadlineS = BASE_TIME_S + 500;
    s = afterState(
      run(contract, s, 'submitProposal', proposalArgs('Community fund', 3000n, deadlineS, 2n)),
    );
    let l = ledger(s);
    expect(l.nextProposalId).toBe(1n);
    const [, p] = [...l.proposals][0];
    expect(p.title).toBe('Community fund');
    expect(p.amount).toBe(3000n);
    expect(p.yes).toBe(0n);
    expect(p.no).toBe(0n);
    expect(p.status).toBe(0); // Open

    s = afterState(run(contract, s, 'vote', [0n, true, secretA]));
    l = ledger(s);
    expect(l.proposals.lookup(0n).yes).toBe(1n);
    expect(l.proposals.lookup(0n).no).toBe(0n);

    s = afterState(run(contract, s, 'vote', [0n, true, secretB]));
    l = ledger(s);
    expect(l.proposals.lookup(0n).yes).toBe(2n);
    expect(l.votesCast.size()).toBe(2n);

    expect(() => run(contract, s, 'executeProposal', [0n])).toThrow(/Deadline/);

    s = afterState(run(contract, s, 'executeProposal', [0n], BASE_TIME_S + 501));
    l = ledger(s);
    expect(l.proposals.lookup(0n).status).toBe(1); // Executed
    expect(l.treasury).toBe(TREASURY - 3000n);
  });

  it('rejects a proposal that misses quorum or loses the vote', () => {
    const { contract, state } = deploy(10_000n);
    const secretA = randomSecret(33);
    const secretB = randomSecret(44);

    let s = afterState(run(contract, state, 'registerMember', [secretA]));
    s = afterState(run(contract, s, 'registerMember', [secretB]));

    const deadlineS = BASE_TIME_S + 500;
    s = afterState(run(contract, s, 'submitProposal', proposalArgs('Too ambitious', 500n, deadlineS, 3n)));

    s = afterState(run(contract, s, 'vote', [0n, true, secretA]));
    s = afterState(run(contract, s, 'vote', [0n, false, secretB]));

    s = afterState(run(contract, s, 'executeProposal', [0n], BASE_TIME_S + 501));
    const l = ledger(s as never);
    expect(l.proposals.lookup(0n).status).toBe(2); // Rejected
    expect(l.treasury).toBe(10_000n);
  });

  it('prevents double voting via public nullifiers', () => {
    const { contract, state } = deploy(10_000n);
    const secret = randomSecret(55);

    let s = afterState(run(contract, state, 'registerMember', [secret]));
    s = afterState(run(contract, s, 'submitProposal', proposalArgs('Once only', 10n, BASE_TIME_S + 500, 1n)));

    s = afterState(run(contract, s, 'vote', [0n, true, secret]));
    expect(() => run(contract, s, 'vote', [0n, true, secret])).toThrow(/voted/);
  });

  it('rejects votes from unregistered credentials', () => {
    const { contract, state } = deploy(10_000n);
    const s = afterState(run(contract, state, 'submitProposal', proposalArgs('No members', 10n, BASE_TIME_S + 500, 1n)));
    expect(() => run(contract, s, 'vote', [0n, true, randomSecret(66)])).toThrow(/member/);
  });

  it('closes voting once the deadline passes', () => {
    const { contract, state } = deploy(10_000n);
    const secret = randomSecret(77);
    let s = afterState(run(contract, state, 'registerMember', [secret]));
    s = afterState(run(contract, s, 'submitProposal', proposalArgs('Tight window', 10n, BASE_TIME_S + 100, 1n)));

    expect(() =>
      run(contract, s, 'vote', [0n, true, secret], BASE_TIME_S + 101),
    ).toThrow(/closed/);
  });
});

describe('Simple DAO — private inputs are NEVER exposed', () => {
  it('the ledger exposes only commitments/nullifiers, never secrets or choices', () => {
    const { contract, state } = deploy(10_000n);

    const secrets = [randomSecret(101), randomSecret(102), randomSecret(103)];
    const secretHexes = secrets.map(toHex);

    let s = state;
    for (const secret of secrets) {
      s = afterState(run(contract, s, 'registerMember', [secret]));
    }
    s = afterState(run(contract, s, 'submitProposal', proposalArgs('Secret audit', 99n, BASE_TIME_S + 500, 2n)));

    s = afterState(run(contract, s, 'vote', [0n, true, secrets[0]]));
    s = afterState(run(contract, s, 'vote', [0n, false, secrets[1]]));
    s = afterState(run(contract, s, 'vote', [0n, true, secrets[2]]));

    const l = ledger(s as never);

    // Aggregate tally is public; individual ballots never (only the net deltas).
    expect(l.proposals.lookup(0n).yes).toBe(2n);
    expect(l.proposals.lookup(0n).no).toBe(1n);

    // ONLY commitments are stored as members.
    const members = [...l.members].map(toHex);
    expect(members).toHaveLength(3);
    for (const secretHex of secretHexes) {
      expect(members).not.toContain(secretHex);
    }

    // ONLY nullifiers are stored as votesCast.
    const nullifiers = [...l.votesCast].map(toHex);
    expect(nullifiers).toHaveLength(3);
    for (const secretHex of secretHexes) {
      expect(nullifiers).not.toContain(secretHex);
    }
    for (const m of members) {
      for (const n of nullifiers) {
        expect(n).not.toContain(m); // distinct per-circuit, no link
      }
    }

    // Every byte string inside the whole decoded ledger must be clean.
    expect(collectHex(l)).not.toEqual(expect.arrayContaining(secretHexes));

    // Second round: another proposal + vote; the raw circuit result context
    // must not contain the member secret either.
    s = afterState(run(contract, s, 'submitProposal', proposalArgs('Round two', 5n, BASE_TIME_S + 500, 1n)));
    const res = run(contract, s, 'vote', [1n, false, secrets[0]]);
    expect(collectHex(res.context)).not.toEqual(expect.arrayContaining(secretHexes));
  });
});