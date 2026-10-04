import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createApp } from './app';
import { fileURLToPath } from 'node:url';
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);
const port = Number(process.env.PORT || 8787),
  host = process.env.HOST || '127.0.0.1';
const app = createApp({
  eventFile:
    process.env.EVENT_FILE ||
    fileURLToPath(new URL('../data/runtime/events.json', import.meta.url)),
  allowWrites:
    process.env.ALLOW_EVENT_WRITES !== 'false' && ['127.0.0.1', 'localhost', '::1'].includes(host),
});
app.listen(port, host, () => console.log(`AccessRoute backend: http://${host}:${port}`));
