import type { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';

/**
 * Wallet discovery across the browser's injected `window.midnight` map.
 * The wallet exposes one or more DApp Connector `InitialAPI` instances, each
 * keyed by a UUID. We surface them so the app can let the user pick one (or
 * auto-select the first compatible instance).
 */
export function listWallets(): InitialAPI[] {
  const injected = (window as unknown as Record<string, unknown>).midnight as Record<string, unknown> | undefined;
  if (!injected) return [];
  return Object.values(injected).filter((wallet): wallet is InitialAPI =>
    typeof wallet === 'object' && wallet !== null && 'apiVersion' in wallet && 'connect' in wallet,
  );
}

export function selectWallet(): InitialAPI {
  const wallets = listWallets();
  if (wallets.length === 0) {
    throw new Error('No Midnight Wallet found. Please install a Midnight Wallet extension and refresh this page.');
  }
  return wallets[0];
}

export function isWalletInstalled(): boolean {
  return listWallets().length > 0;
}