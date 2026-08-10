import { useState } from 'react';
import { type Proposal, formatAmount } from '../lib/dao-types';

export interface ProposalCardProps {
  proposal: Proposal;
  isExecutor: boolean;
  isMember: boolean;
  onVote: (proposalId: bigint, choice: boolean, secret: Uint8Array) => Promise<void>;
  onExecute: (proposalId: bigint) => Promise<void>;
  getMemberSecret: () => Uint8Array;
}

function statusBadge(status: Proposal['status']): string {
  switch (status) {
    case 'Executed':
      return 'badge badge-executed';
    case 'Rejected':
      return 'badge badge-rejected';
    default:
      return 'badge badge-open';
  }
}

export default function ProposalCard({
  proposal,
  isExecutor,
  isMember,
  onVote,
  onExecute,
  getMemberSecret,
}: ProposalCardProps) {
  const [busy, setBusy] = useState<'vote' | 'execute' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = proposal.status === 'Open';
  const deadlinePassed = proposal.deadline <= BigInt(Date.now());
  const canExecute = open && isExecutor && deadlinePassed;
  const [choice, setChoice] = useState<boolean>(true);

  const run = async (action: 'vote' | 'execute') => {
    setBusy(action);
    setError(null);
    try {
      if (action === 'vote') {
        await onVote(proposal.id, choice, getMemberSecret());
      } else {
        await onExecute(proposal.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card proposal">
      <div className="proposal-header">
        <div>
          <h3>
            #{proposal.id.toString()} · {proposal.title}
          </h3>
          <p className="muted">
            Amount <strong>{formatAmount(proposal.amount)}</strong> → recipient abridged:{' '}
            {proposal.recipientsHex.slice(0, 10)}…{proposal.recipientsHex.slice(-6)}
          </p>
        </div>
        <span className={statusBadge(proposal.status)}>{proposal.status}</span>
      </div>
      <p className="muted">
        Votes — yes: <strong>{proposal.yes.toString()}</strong> / no:{' '}
        <strong>{proposal.no.toString()}</strong> · quorum needed{' '}
        <strong>&ge; {proposal.quorum.toString()}</strong> · closes{' '}
        <strong>{new Date(Number(proposal.deadline)).toLocaleString()}</strong>
      </p>
      {open && !deadlinePassed && isMember && (
        <div className="vote-controls">
          <label>
            <input type="radio" checked={choice === true} onChange={() => setChoice(true)} /> Yes
          </label>
          <label>
            <input type="radio" checked={choice === false} onChange={() => setChoice(false)} /> No
          </label>
          <button
            className="btn btn-primary"
            disabled={busy !== null}
            onClick={() => void run('vote')}
          >
            {busy === 'vote' ? 'Proving & voting…' : 'Vote'}
          </button>
          <p className="privacy-note">Proved without revealing your input.</p>
        </div>
      )}
      {open && deadlinePassed && (
        <p className="muted">
          Voting has closed. The proposal now passes only if it reached quorum and got more yes than no votes.
        </p>
      )}
      {canExecute && (
        <button
          className="btn btn-primary"
          disabled={busy !== null}
          onClick={() => void run('execute')}
        >
          {busy === 'execute' ? 'Proving & executing…' : 'Execute (or reject) proposal'}
        </button>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}