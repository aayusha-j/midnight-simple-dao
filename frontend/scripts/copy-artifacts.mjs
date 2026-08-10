import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const managed = path.join(root, 'contracts', 'managed', 'simple-dao');
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'zk', 'simple-dao');

if (!existsSync(path.join(managed, 'contract', 'index.js'))) {
  execSync('npm run compile', { stdio: 'inherit', cwd: root });
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(path.join(managed, 'zkir'), path.join(outDir, 'zkir'), { recursive: true });
cpSync(path.join(managed, 'keys'), path.join(outDir, 'keys'), { recursive: true });
console.log(`Copied compiled ZK artifacts to ${outDir}`);