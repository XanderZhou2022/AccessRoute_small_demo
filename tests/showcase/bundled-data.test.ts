import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBundledShowcaseJson } from '../../frontend/src/showcase/bundledData';
import { validateScene, type Scene } from '../../shared/domain/schema';
import { showcaseCases } from '../../shared/demo/showcase';
import { applyDemoOverlay, demoRoute } from '../../shared/demo/navigation';
import type { DemoCase, DemoMedia, DemoOverlay } from '../../shared/demo/types';

afterEach(() => vi.unstubAllGlobals());

describe('bundled presentation data', () => {
  it('replays all three stories when every separate data request would return 503', () => {
    const fetch = vi.fn(async () => new Response('Unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const overlays = readBundledShowcaseJson<DemoOverlay[]>('data/demo/overlays.json');
    const media = readBundledShowcaseJson<{ media: DemoMedia[] }>('data/demo/index.json');
    const scenes = new Map<string, Scene>();
    for (const preset of showcaseCases) {
      const example = readBundledShowcaseJson<DemoCase>(`data/demo/cases/${preset.id}.json`);
      for (const step of example.steps) {
        const sceneId = step.state.scene_id;
        if (!scenes.has(sceneId)) {
          const folder = `data/scenes/${sceneId}/`;
          const manifest = readBundledShowcaseJson<Scene['manifest']>(`${folder}manifest.json`);
          const layers = Object.fromEntries(
            Object.entries(manifest.files).map(([key, file]) => [
              key,
              readBundledShowcaseJson(`${folder}${file}`),
            ]),
          );
          const scene = validateScene({ manifest, ...layers } as Scene);
          const overlay = overlays.find((item) => item.scene_id === sceneId);
          scenes.set(sceneId, overlay ? applyDemoOverlay(scene, overlay) : scene);
        }
        expect(demoRoute(scenes.get(sceneId)!, step.state).result).toEqual(step.route.result);
        expect(step.media_ids.every((id) => media.media.some((item) => item.id === id))).toBe(true);
      }
    }
    expect(scenes.size).toBe(4);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps replay data fresh and rejects a case that is not packaged', () => {
    const path = `data/demo/cases/${showcaseCases[0].id}.json`;
    const original = readBundledShowcaseJson<DemoCase>(path);
    const changed = readBundledShowcaseJson<DemoCase>(path);
    changed.steps[0].state.routing.events.length = 0;
    changed.steps.length = 0;
    expect(readBundledShowcaseJson<DemoCase>(path)).toEqual(original);
    expect(() => readBundledShowcaseJson('data/demo/cases/unknown.json')).toThrow('未包含');
  });
});
