import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const dest = fileURLToPath(new URL('../frontend/public/data', import.meta.url));
await mkdir(dest, { recursive: true });
await rm(dest + '/scenes', { recursive: true, force: true });
await cp(fileURLToPath(new URL('../data/scenes', import.meta.url)), dest + '/scenes', {
  recursive: true,
});
