import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { showcaseCases, showcaseChapters } from '../shared/demo/showcase';
import type { DemoCase, DemoMedia } from '../shared/demo/types';

const dist = resolve('frontend/dist');
const base = process.env.BASE_PATH?.startsWith('/') ? process.env.BASE_PATH : '/';
const origin = 'https://pages.example';
const page = new URL(`${base}showcase/index.html`, origin);
const html = await readFile(resolve(dist, 'showcase/index.html'), 'utf8');
const paths = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
for (const path of paths) {
  const url = new URL(path, page);
  if (url.origin !== origin || !url.pathname.startsWith(base))
    throw new Error(`Asset escapes Pages base: ${path}`);
  await access(resolve(dist, decodeURIComponent(url.pathname.slice(base.length))));
}
const index = JSON.parse(await readFile(resolve(dist, 'data/demo/index.json'), 'utf8')) as {
  media: DemoMedia[];
};
let checkedAudio = 0;
for (const preset of showcaseCases) {
  const story = JSON.parse(
    await readFile(resolve(dist, `data/demo/cases/${preset.id}.json`), 'utf8'),
  ) as DemoCase;
  for (const chapter of showcaseChapters) {
    const audio = await readFile(resolve(dist, `showcase/audio/${preset.id}-${chapter.id}.m4a`));
    if (audio.subarray(4, 8).toString() !== 'ftyp')
      throw new Error(`Invalid audio: ${preset.id}/${chapter.id}`);
    checkedAudio += 1;
  }
  for (const sceneId of new Set(story.steps.map((step) => step.state.scene_id))) {
    const folder = `data/scenes/${sceneId}`;
    const manifest = JSON.parse(await readFile(resolve(dist, folder, 'manifest.json'), 'utf8'));
    for (const file of Object.values(manifest.files))
      await access(resolve(dist, folder, String(file)));
  }
  for (const step of story.steps)
    for (const id of step.media_ids) {
      const record = index.media.find((item) => item.id === id);
      if (!record) throw new Error(`Unknown showcase media: ${id}`);
      await access(resolve(dist, 'data/demo', record.path));
    }
}
await access(resolve(dist, 'data/demo/overlays.json'));
await access(resolve(dist, 'showcase/media/kfc-localization.png'));
await access(resolve(dist, 'showcase/media/lift-demo.png'));
await access(resolve(dist, 'showcase/credits.txt'));
console.log(
  `Showcase static audit passed: base ${base}, ${paths.length} HTML assets, ${showcaseCases.length} stories, ${checkedAudio} Cantonese clips, scene and photo assets.`,
);
