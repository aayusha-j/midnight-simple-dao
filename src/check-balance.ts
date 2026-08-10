import { resolveNetwork, getOrCreateSeed } from './network.js';
import { createWallet, unshieldedToken } from './wallet.js';

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateSeed(network);

async function main() {
  const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
  const state = await walletCtx.wallet.waitForSyncedState();
  const address = walletCtx.unshieldedKeystore.getBech32Address();
  const tNight = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  const dust = state.dust.balance(new Date());
  console.log(`Network:      ${network}`);
  console.log(`Wallet:       ${address}`);
  console.log(`tNight:       ${tNight.toLocaleString()}`);
  console.log(`DUST:         ${dust.toLocaleString()}`);
  await walletCtx.wallet.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});