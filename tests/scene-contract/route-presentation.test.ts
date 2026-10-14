import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Scene, RouteSegment } from '../../shared/domain/schema';
import {
  segmentColor,
  transitionText,
  endpoints,
} from '../../frontend/src/renderers/routePresentation';
const manifest = JSON.parse(
  readFileSync(new URL('../../data/scenes/hysan-place/manifest.json', import.meta.url), 'utf8'),
);
const graph = JSON.parse(
  readFileSync(new URL('../../data/scenes/hysan-place/graph.json', import.meta.url), 'utf8'),
);
const scene = { manifest, graph } as Scene;
const [ground, upper] = manifest.levels;
const transition = {
  type: 'transition',
  mode: 'lift',
  fromLevel: upper.id,
  toLevel: ground.id,
} as RouteSegment;
test('floor colours stay distinct and vertical instructions follow travel direction', () => {
  const upperSegment = { type: 'floor', levelId: upper.id } as RouteSegment;
  const groundSegment = { type: 'floor', levelId: ground.id } as RouteSegment;
  expect(segmentColor(scene, upperSegment)).not.toBe(segmentColor(scene, groundSegment));
  expect(
    segmentColor({ ...scene, manifest: { ...manifest, levels: [upper, ground] } }, upperSegment),
  ).toBe(segmentColor(scene, upperSegment));
  expect(transitionText(scene, transition)).toBe('電梯下樓 · 1/F → G/F');
  expect(transitionText(scene, { ...transition, fromLevel: ground.id, toLevel: upper.id })).toBe(
    '電梯上樓 · G/F → 1/F',
  );
  expect(transitionText(scene, { ...transition, mode: 'stairs' })).toBe('樓梯下樓 · 1/F → G/F');
});
test('endpoint names reverse with the route, including the station', () => {
  const outward = [{ nodeIds: [manifest.defaultStart, manifest.defaultEnd] }] as RouteSegment[];
  expect(endpoints(scene, outward)[1]).toMatchObject({ role: '終點', detail: manifest.stationZh });
  const inward = [{ nodeIds: [manifest.defaultEnd, manifest.defaultStart] }] as RouteSegment[];
  expect(endpoints(scene, inward)[0]).toMatchObject({ role: '起點', detail: manifest.stationZh });
  expect(endpoints(scene, inward)[1].detail).toContain(manifest.nameZh);
});
