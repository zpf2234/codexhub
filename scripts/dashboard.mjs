import { spawn } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';

const portIndex = process.argv.indexOf('--port');
const explicitPort = portIndex >= 0 || Boolean(process.env.PORT);
let port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Dashboard port must be an integer from 1 to 65535.');

function portAvailable(candidate) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(candidate, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

if (!explicitPort && !(await portAvailable(port))) {
  const firstPort = port;
  while (port < 65535 && !(await portAvailable(++port))) {}
  if (port >= 65535) throw new Error(`No available dashboard port after ${firstPort}.`);
  console.log(`Dashboard port ${firstPort} is busy; using ${port}.`);
}
process.env.PORT = String(port);

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
});

await run('node', ['scripts/discovery/local-inventory.mjs', '--write']);
await run('node', ['scripts/build-catalog.mjs', '--cached']);
if (process.argv.includes('--build-only')) process.exit(0);
console.log(`Discovery dashboard: http://127.0.0.1:${port}/discovery.html`);
await run('node', ['scripts/serve.mjs']);
