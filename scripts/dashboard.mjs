import { spawn } from 'node:child_process';
import process from 'node:process';

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
});

await run('node', ['scripts/build-catalog.mjs', '--cached']);
if (process.argv.includes('--build-only')) process.exit(0);
console.log('Discovery dashboard: http://127.0.0.1:4173/discovery.html');
await run('node', ['scripts/serve.mjs']);
