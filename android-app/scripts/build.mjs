import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryDirectory = resolve(appDirectory, '..');
const mode = process.argv[2];
const apiUrl = process.env.ACCESSROUTE_API_URL;

if (!['add', 'sync', 'debug'].includes(mode)) {
  throw new Error('Use one of: add, sync, debug.');
}
if (!apiUrl) {
  throw new Error('Set ACCESSROUTE_API_URL to the HTTPS origin of the AccessRoute API.');
}

const parsedApiUrl = new URL(apiUrl);
if (
  parsedApiUrl.protocol !== 'https:' ||
  parsedApiUrl.pathname !== '/' ||
  parsedApiUrl.search ||
  parsedApiUrl.hash ||
  parsedApiUrl.username ||
  parsedApiUrl.password
) {
  throw new Error('ACCESSROUTE_API_URL must be an HTTPS origin without credentials or a path.');
}

const env = {
  ...process.env,
  BASE_PATH: './',
  VITE_API_BASE_URL: parsedApiUrl.origin,
  VITE_ANDROID_APP: 'true',
  VITE_PROVIDER: 'static',
};

function run(command, args, cwd, environment = env) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], repositoryDirectory);
if (mode === 'add') {
  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['cap', 'add', 'android'], appDirectory);
} else {
  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['cap', 'sync', 'android'], appDirectory);
}
if (mode === 'debug') {
  run(
    process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
    ['assembleDebug'],
    resolve(appDirectory, 'android'),
  );
}
