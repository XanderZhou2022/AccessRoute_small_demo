import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { validateScene, type Scene } from '../shared/domain/schema';
import { examples, type IntegrationContext } from '../shared/genai/contracts';
import { route } from '../shared/routing/route';
import { segmentRoute } from '../shared/journey/segment';
const base = new URL('../data/scenes/hysan-place/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
const data = Object.fromEntries(
  await Promise.all(
    Object.entries(manifest.files).map(async ([k, v]) => [
      k,
      JSON.parse(await readFile(new URL(String(v), base), 'utf8')),
    ]),
  ),
);
const scene = validateScene({ manifest, ...data } as Scene);
const result = route(scene.graph, manifest.defaultStart, manifest.defaultEnd, {
  profile: 'wheelchair',
  rain: false,
  strictAccessibility: false,
  now: new Date().toISOString(),
  events: [],
});
const context: IntegrationContext = {
  version: '1.0',
  context_id: 'replace-with-live-context-id',
  scene_id: manifest.sceneId,
  phase: 'planning',
  profile: 'wheelchair',
  preferences: null,
  current_node_id: manifest.defaultStart,
  destination_node_id: manifest.defaultEnd,
  segment: segmentRoute(scene.graph, result)[0],
  levels: manifest.levels,
  facilities: scene.graph.facilities,
};
const out = new URL('../examples/genai/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL('context.json', out), JSON.stringify(context, null, 2) + '\n');
for (const example of examples(context, scene))
  await writeFile(new URL(example.agent + '.json', out), JSON.stringify(example, null, 2) + '\n');
