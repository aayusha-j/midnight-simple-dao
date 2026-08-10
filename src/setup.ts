// Orchestrator for `npm run setup`.
//
// Brings up only the services the chosen network needs, then compiles the
// contract and deploys it. On public networks (preview/preprod) all services
// are hosted, so local Docker is optional — if Docker is unavailable we skip
// `docker compose` with a warning and continue with compile + deploy.
import { spawnSync } from 'node:child_process';
import { resolveNetwork, setActiveNetwork, parseNetworkFlag } from './network.js';

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    process.stderr.write(`\nCommand failed: ${cmd} ${args.join(' ')}\n`);
    process.exit(r.status ?? 1);
  }
}

function dockerAvailable(): boolean {
  const probe = spawnSync('docker', ['--version'], { stdio: 'ignore' });
  return probe.status === 0;
}

async function main(): Promise<void> {
  const argv = process.argv;
  const flag = parseNetworkFlag(argv);
  if (flag) setActiveNetwork(flag);
  const { network, config } = resolveNetwork({ argv });

  process.stdout.write(`\n→ Setting up simple-dao on network: ${network}\n\n`);

  // 1. Bring up only the services this network needs (hosted networks need none).
  if (config.composeServices.length > 0) {
    if (dockerAvailable()) {
      run('docker', ['compose', 'up', '-d', '--wait', ...config.composeServices]);
    } else {
      process.stdout.write(
        '  ⚠ Docker is not available in this environment; skipping local services.\n' +
        '    (Public networks use hosted services, which are configured below.)\n\n',
      );
    }
  } else {
    process.stdout.write('  No local services needed for this network — using hosted services.\n\n');
  }

  // 2. Compile the contract (network-agnostic).
  run('npm', ['run', 'compile']);

  // 3. Deploy. Forward --network so deploy.ts sees the same network.
  const deployArgs = flag ? ['--', '--network', network] : [];
  run('npm', ['run', 'deploy', ...deployArgs]);
}

main().catch((e) => {
  process.stderr.write(`\nSetup failed: ${(e as Error).message}\n`);
  process.exit(1);
});