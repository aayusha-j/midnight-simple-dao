import type { UseMidnightResult } from '../hooks/useMidnight';

function shortAddress(addr: string): string {
  if (addr.length <= 20) return addr;
  return `${addr.slice(0, 12)}…${addr.slice(-8)}`;
}

export default function WalletConnect({ midnight }: { midnight: UseMidnightResult }) {
  const { state, unshieldedAddress, error, connect, disconnect, isConnected } = midnight;

  if (state === 'no-wallet') {
    return (
      <div className="wallet-banner wallet-error">
        No Midnight Wallet detected. Install the{' '}
        <a
          href="https://wallet.docs.midnight.network/use-midnight-network/getting-started"
          target="_blank"
          rel="noopener noreferrer"
        >
          Midnight Wallet
        </a>{' '}
        browser extension, then refresh this page.
      </div>
    );
  }

  if (isConnected && unshieldedAddress) {
    return (
      <div className="wallet-session">
        <span className="wallet-ok">Connected</span>
        <span className="wallet-address" title={unshieldedAddress}>
          {shortAddress(unshieldedAddress)}
        </span>
        <button onClick={disconnect} className="btn btn-ghost">
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-session">
      <button
        onClick={() => void connect()}
        className="btn btn-primary"
        disabled={state === 'connecting'}
      >
        {state === 'connecting' ? 'Connecting…' : 'Connect Wallet'}
      </button>
      {state === 'error' && error && <span className="wallet-error">{error}</span>}
    </div>
  );
}