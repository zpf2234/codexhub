import { spawn } from 'node:child_process';
import process from 'node:process';

const env = {
  ...process.env,
  DISCOVERY_MAX_SOURCES_PER_RUN: process.env.DISCOVERY_MAX_SOURCES_PER_RUN || '1',
  DISCOVERY_MAX_REPOSITORIES: process.env.DISCOVERY_MAX_REPOSITORIES || '25',
  DISCOVERY_MAX_ARTIFACTS_PER_REPOSITORY: process.env.DISCOVERY_MAX_ARTIFACTS_PER_REPOSITORY || '2',
  DISCOVERY_SCAN_CONCURRENCY: process.env.DISCOVERY_SCAN_CONCURRENCY || '4',
  MCP_REGISTRY_MAX_PAGES: process.env.MCP_REGISTRY_MAX_PAGES || '3'
};

const run = (args) => new Promise((resolve, reject) => {
  const child = spawn('node', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`node exited with ${code}`)));
});

await run(['scripts/discovery/local-inventory.mjs', '--write']);
await run(['scripts/discover.mjs']);
await run(['scripts/build-catalog.mjs', '--cached']);
