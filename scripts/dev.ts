import './sync-data';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
const viteArgs = ['node_modules/vite/bin/vite.js', '--config', 'frontend/vite.config.ts'];
if (process.argv.includes('--lan')) viteArgs.push('--host', '0.0.0.0');

const children = [
  spawn('node', ['--import', 'tsx', 'backend/server.ts'], { stdio: 'inherit' }),
  spawn('node', viteArgs, { stdio: 'inherit' }),
];

// Start the default local Cantonese TTS unless a custom TTS or Azure is configured.
const ttsPython = '.venv-tts/bin/python';
const usesDefaultTts = !process.env.CANTO_TTS_URL?.trim() && !process.env.AZURE_SPEECH_KEY?.trim();
const portBusy = await new Promise<boolean>((resolve) => {
  const probe = net.connect(8000, '127.0.0.1');
  probe.once('connect', () => (probe.destroy(), resolve(true)));
  probe.once('error', () => resolve(false));
});
if (usesDefaultTts && !portBusy) {
  if (existsSync(ttsPython)) {
    const tts = spawn(
      ttsPython,
      ['-m', 'uvicorn', 'services.canto_tts_server:app', '--host', '127.0.0.1', '--port', '8000'],
      { stdio: 'inherit' },
    );
    // A TTS crash should not take down the web app; speech reports its own error.
    tts.on('exit', (code) => console.warn(`Cantonese TTS stopped (exit ${code}).`));
    children.push(tts);
  } else {
    console.warn(
      'Cantonese TTS is not installed. Run: python3 -m venv .venv-tts && .venv-tts/bin/python -m pip install -r services/requirements-tts.txt',
    );
  }
}
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    children.forEach((p) => p.kill(sig));
    process.exit(0);
  });
for (const child of children.slice(0, 2))
  child.on('exit', (code) => {
    if (code) {
      children.forEach((p) => p.kill());
      process.exit(code);
    }
  });
