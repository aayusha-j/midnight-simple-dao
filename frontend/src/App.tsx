import { useCallback, useState } from 'react';
import WalletConnect from './components/WalletConnect';
import SubmitProposal from './components/SubmitProposal';
import ProposalCard from './components/ProposalCard';
import { useMidnight } from './hooks/useMidnight';
import { useDao } from './hooks/useDao';
import { resolveDefaultContractAddress } from './lib/dao-reader';

const MEMBER_SECRET_KEY = 'simple-dao-member-secret';
const MEMBER_REGISTERED_KEY = 'simple-dao-member-registered';

function getMemberSecret(): Uint8Array {
  const stored = localStorage.getItem(MEMBER_SECRET_KEY);
  if (stored) {
    return Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  }
  const secret = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(MEMBER_SECRET_KEY, btoa(String.fromCharCode(...secret)));
  return secret;
}

export default function App() {
  const [contractAddress] = useState(resolveDefaultContractAddress);
  const midnight = useMidnight(contractAddress);
  const dao = useDao(contractAddress);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(
    () => localStorage.getItem(MEMBER_REGISTERED_KEY) === 'yes',
  );

  const wrapAction = useCallback(
    async (label: string, action: () => Promise<void>) => {
      if (!midnight.deployed) {
        setActionError('Connect your wallet first.');
        return;
      }
      setBusyLabel(label);
      setActionError(null);
      try {
        await action();
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await dao.refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyLabel(null);
      }
    },
    [midnight.deployed, dao],
  );

  const registerMember = useCallback(async () => {
    await wrapAction('Generating zero-knowledge proof for membership', async () => {
      await midnight.deployed!.callTx.registerMember(getMemberSecret());
      localStorage.setItem(MEMBER_REGISTERED_KEY, 'yes');
      setRegistered(true);
    });
  }, [midnight.deployed, wrapAction]);

  const notConfigured =
    !contractAddress ||
    !/^[0-9a-fA-F]{64}$/.test(contractAddress);

  return (
    <div className="app">
      <header className="header">
        <h1>Simple DAO — Midnight Network</h1>
        <WalletConnect midnight={midnight} />
      </header>

      {notConfigured && (
        <div className="wallet-banner wallet-error">
          This frontend has no deployed contract address. Run{' '}
          <code>npm run deploy -- --network preview</code> at the repo root, then set{' '}
          <code>VITE_DAO_CONTRACT_ADDRESS</code> in <code>frontend/.env.local</code>.
        </div>
      )}

      <section className="dashboard">
        <div className="stat-card">
          <span className="stat-label">Treasury</span>
          <span className="stat-value">{dao.treasury.toLocaleString()}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Members</span>
          <span className="stat-value">{dao.memberCount}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Proposals</span>
          <span className="stat-value">{dao.proposals.length}</span>
        </div>
      </section>

      {busyLabel && <p className="busy-label">⏳ {busyLabel} …</p>}
      {actionError && <p className="error-text">{actionError}</p>}

      {midnight.isConnected && (
        <section className="membership">
          {registered ? (
            <p className="wallet-ok">
              You are a registered DAO member. Your membership credential is stored only in this
              browser and is never sent on-chain — only a commitment is.
            </p>
          ) : (
            <button
              className="btn btn-primary"
              disabled={busyLabel !== null}
              onClick={() => void registerMember()}
            >
              {busyLabel?.startsWith('Generating zero-knowledge proof for membership')
                ? 'Proving & registering…'
                : 'Register as a DAO member'}
            </button>
          )}
          <p className="privacy-note">Proved without revealing your input.</p>
        </section>
      )}

      <div className="content-grid">
        <SubmitProposal
          disabled={!midnight.isConnected}
          onSubmit={async (input) => {
            await wrapAction('Generating zero-knowledge proof & submitting proposal', async () => {
              await midnight.deployed!.callTx.submitProposal(
                input.title,
                input.amount,
                Uint8Array.from(input.recipientHex.match(/.{2}/g)!.map((h) => parseInt(h, 16))),
                input.deadlineMs,
                input.quorumCount,
              );
            });
          }}
        />

        <section className="proposals">
          <h2>Proposals</h2>
          {dao.loading && dao.proposals.length === 0 ? (
            <p className="muted">Loading on-chain state…</p>
          ) : dao.proposals.length === 0 ? (
            <p className="muted">No proposals yet. Be the first to add one.</p>
          ) : (
            dao.proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id.toString()}
                proposal={proposal}
                isMember={midnight.isConnected && registered}
                isExecutor={midnight.isConnected}
                getMemberSecret={getMemberSecret}
                onVote={async (proposalId, choice, secret) => {
                  await wrapAction('Generating privacy proof for your vote', async () => {
                    await midnight.deployed!.callTx.vote(proposalId, choice, secret);
                  });
                }}
                onExecute={async (proposalId) => {
                  await wrapAction('Finalizing proposal on-chain', async () => {
                    await midnight.deployed!.callTx.executeProposal(proposalId);
                  });
                }}
              />
            ))
          )}
        </section>
      </div>

      <footer className="footer">
        <p>
          Governance is private: yes/no votes are hidden and only the aggregate tally is recorded
          on-chain.
        </p>
      </footer>
    </div>
  );
}