import './sync-data';
import { spawn } from 'node:child_process';
const viteArgs = ['node_modules/vite/bin/vite.js', '--config', 'frontend/vite.config.ts'];
if (process.argv.includes('--lan')) viteArgs.push('--host', '0.0.0.0');

const children = [
  spawn('node', ['--import', 'tsx', 'backend/server.ts'], { stdio: 'inherit' }),
  spawn('node', viteArgs, { stdio: 'inherit' }),
];
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    children.forEach((p) => p.kill(sig));
    process.exit(0);
  });
for (const child of children)
  child.on('exit', (code) => {
    if (code) {
      children.forEach((p) => p.kill());
      process.exit(code);
    }
  });
