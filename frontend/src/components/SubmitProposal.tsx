import { useState } from 'react';

export interface SubmitProposalProps {
  onSubmit: (input: {
    title: string;
    amount: bigint;
    recipientHex: string;
    deadlineMs: bigint;
    quorumCount: bigint;
  }) => Promise<void>;
  disabled?: boolean;
}

export default function SubmitProposal({ onSubmit, disabled }: SubmitProposalProps) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [recipientHex, setRecipientHex] = useState('');
  const [days, setDays] = useState('1');
  const [quorum, setQuorum] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanRecipient = recipientHex.trim().replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{64}$/.test(cleanRecipient)) {
      setError('Recipient must be exactly 64 hex characters.');
      return;
    }
    const amountN = BigInt(amount.trim() || '0');
    const daysN = Number(days.trim() || '1');
    const quorumN = BigInt(quorum.trim() || '1');
    if (amountN <= 0n) {
      setError('Amount must be greater than 0.');
      return;
    }
    if (!(daysN > 0)) {
      setError('Voting period must be a positive number of days.');
      return;
    }
    if (quorumN < 1n) {
      setError('Quorum must be at least 1.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        amount: amountN,
        recipientHex: cleanRecipient,
        deadlineMs: BigInt(Date.now() + daysN * 86_400_000),
        quorumCount: quorumN,
      });
      setTitle('');
      setAmount('');
      setRecipientHex('');
      setDays('1');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card" onSubmit={(e) => void handleSubmit(e)}>
      <h2>Submit a spending proposal</h2>
      <label>
        Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Fund the community event"
          required
          maxLength={120}
        />
      </label>
      <label>
        Amount
        <input
          type="number"
          min="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (whole units)"
          required
        />
      </label>
      <label>
        Recipient (unshielded address bytes, 64 hex chars)
        <input
          type="text"
          value={recipientHex}
          onChange={(e) => setRecipientHex(e.target.value)}
          placeholder="64-character hex"
          required
        />
      </label>
      <div className="row">
        <label>
          Voting period (days)
          <input
            type="number"
            min="1"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            required
          />
        </label>
        <label>
          Yes-quorum required
          <input
            type="number"
            min="1"
            value={quorum}
            onChange={(e) => setQuorum(e.target.value)}
            required
          />
        </label>
      </div>
      <p className="privacy-note">Proved without revealing your input.</p>
      {error && <p className="error-text">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={disabled || submitting}>
        {submitting ? 'Proving & submitting…' : 'Submit proposal'}
      </button>
    </form>
  );
}