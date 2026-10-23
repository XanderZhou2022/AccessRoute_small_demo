import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { scene } from '../fixtures';
import type { DemoCase, DemoOverlay } from '../../shared/demo/types';
import { applyDemoOverlay, demoRoute } from '../../shared/demo/navigation';
import {
  confirmShowcaseStep,
  needsShowcaseConfirmation,
  showcaseCases,
  showcaseChapters,
  showcaseState,
} from '../../shared/demo/showcase';

const overlays = JSON.parse(readFileSync('data/demo/overlays.json', 'utf8')) as DemoOverlay[];
const story = (id: string) =>
  JSON.parse(readFileSync(`data/demo/cases/${id}.json`, 'utf8')) as DemoCase;
const demoScene = (id: string) => {
  const original = scene(id);
  const overlay = overlays.find((item) => item.scene_id === id);
  return overlay ? applyDemoOverlay(original, overlay) : original;
};

describe('GitHub Pages showcase journeys', () => {
  for (const preset of showcaseCases) {
    it(`${preset.id}: reconstructs every chapter from the bundled map without a backend`, () => {
      const example = story(preset.id);
      const displayedPlaces = preset.journey.split(' → ');
      expect(displayedPlaces).toEqual([
        scene(example.origin_scene_id).manifest.nameZh.split('・')[0],
        scene(example.destination_scene_id).manifest.nameZh.split('・')[0],
      ]);
      expect(example.steps.map((step) => step.id)).toEqual(
        showcaseChapters.map((chapter) => chapter.id),
      );
      for (let index = 0; index < example.steps.length; index += 1) {
        const step = example.steps[index];
        const current = showcaseState(example, index, null);
        const graph = demoScene(current.scene_id);
        const before = demoRoute(graph, current);
        expect(before.result.status).toBe('ok');
        if (needsShowcaseConfirmation(step.id)) {
          expect(current).toEqual(example.steps[index - 1].state);
          const serialized = JSON.stringify(example);
          const applied = confirmShowcaseStep(graph, example, index);
          const after = demoRoute(graph, applied);
          expect(after.result.status).toBe('ok');
          expect(after.result).toEqual(step.route.result);
          expect(JSON.stringify(example)).toBe(serialized);
          if (step.id === 'fault') {
            expect(after.facilities).not.toEqual(before.facilities);
            expect(applied.routing.events.length).toBeGreaterThan(current.routing.events.length);
          } else {
            expect(applied.current_node_id).not.toBe(current.current_node_id);
          }
          expect(showcaseState(example, index, applied)).toBe(applied);
          // Resetting restores the pre-confirmation snapshot, including the original facility state.
          expect(demoRoute(graph, showcaseState(example, index, null)).result).toEqual(
            before.result,
          );
        } else {
          expect(before.result).toEqual(step.route.result);
        }
      }
    });
    it(`${preset.id}: ships all eight prerecorded Cantonese clips and the exact guidance transcript`, () => {
      const example = story(preset.id);
      const audio = JSON.parse(
        readFileSync('frontend/public/showcase/audio/transcripts.json', 'utf8'),
      ) as { clips: { case: string; step: string; file: string; text: string }[] };
      for (const step of example.steps) {
        const file = `frontend/public/showcase/audio/${preset.id}-${step.id}.m4a`;
        expect(existsSync(file)).toBe(true);
        const data = readFileSync(file);
        expect(data.subarray(4, 8).toString()).toBe('ftyp');
        expect(data.length).toBeGreaterThan(1000);
        const transcript = audio.clips.find(
          (clip) => clip.case === preset.id && clip.step === step.id,
        );
        expect(transcript?.text).toBeTruthy();
        if (step.id === 'guidance') expect(transcript?.text).toBe(step.state.guidance);
      }
    });
  }
  it('does not apply a preset confirmation to an unrelated chapter or scene', () => {
    const example = story(showcaseCases[0].id);
    expect(() => confirmShowcaseStep(demoScene(example.origin_scene_id), example, 1)).toThrow();
    expect(() => confirmShowcaseStep(demoScene('hysan-place'), example, 3)).toThrow();
  });
});
