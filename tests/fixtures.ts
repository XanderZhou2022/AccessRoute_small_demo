import {
  graphSchema,
  type MobilityGraph,
  type RoutingContext,
  type Scene,
  validateScene,
} from '../shared/domain/schema';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export const ctx: RoutingContext = {
  profile: 'wheelchair',
  rain: false,
  strictAccessibility: false,
  now: '2026-09-27T00:00:00Z',
  events: [],
};
export function fixture(): MobilityGraph {
  return graphSchema.parse({
    schemaVersion: '1.0',
    sceneId: 'third-scene',
    nodes: [
      ['start', 'G'],
      ['a0', 'G'],
      ['a1', 'L1'],
      ['b0', 'G'],
      ['b1', 'L1'],
      ['end', 'L1'],
    ].map(([id, levelId], i) => ({
      id,
      sceneId: 'third-scene',
      venueId: 'v',
      levelId,
      lon: 114 + i * 0.00001,
      lat: 22,
      kind: 'junction',
    })),
    facilities: [
      { id: 'lift-a', label: 'A', kind: 'lift' },
      { id: 'lift-b', label: 'B', kind: 'lift' },
      { id: 'stairs', label: 'stairs', kind: 'stairs' },
    ],
    edges: [
      ['s-a', 'start', 'a0', 2, 'corridor'],
      ['a', 'a0', 'a1', 3, 'lift', 'lift-a'],
      ['a-t', 'a1', 'end', 2, 'corridor'],
      ['s-b', 'start', 'b0', 5, 'corridor'],
      ['b', 'b0', 'b1', 3, 'lift', 'lift-b'],
      ['b-t', 'b1', 'end', 5, 'corridor'],
      ['stairs-edge', 'start', 'end', 1, 'stairs', 'stairs'],
    ].map(([id, from, to, distanceM, kind, facilityId]) => ({
      id,
      from,
      to,
      distanceM,
      kind,
      facilityId,
      wheelchair: 'yes',
      provenance: 'official',
    })),
  });
}
export function scene(id: string): Scene {
  const base = resolve('data/scenes', id);
  const manifest = JSON.parse(readFileSync(base + '/manifest.json', 'utf8'));
  const data = Object.fromEntries(
    Object.entries(manifest.files).map(([k, v]) => [
      k,
      JSON.parse(readFileSync(base + '/' + v, 'utf8')),
    ]),
  );
  return validateScene({ manifest, ...data } as Scene);
}
export const close = (fid: string) => ({
  id: 'close-' + fid,
  type: 'facility_closed' as const,
  target: { facilityId: fid },
  status: 'active' as const,
  validFrom: '2026-09-26T00:00:00Z',
  source: 'demo' as const,
});
