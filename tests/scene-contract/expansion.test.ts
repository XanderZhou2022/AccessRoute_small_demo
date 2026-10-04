import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scene, ctx } from '../fixtures';
import { route } from '../../shared/routing/route';
import { segmentRoute } from '../../shared/journey/segment';
import { validateScene, type Profile } from '../../shared/domain/schema';
const ids: string[] = JSON.parse(readFileSync(new URL('../../data/scenes/index.json', import.meta.url), 'utf8')).scenes;
it('12 distinct scenes provide 132 ordered journeys with usable first/last legs', () => {
  expect(ids).toHaveLength(12);
  expect(new Set(ids).size).toBe(12);
  const legs = new Map();
  for (const id of ids) {
    const s = validateScene(scene(id));
    for (const profile of ['wheelchair', 'elderly', 'stroller'] as Profile[]) {
      for (const reverse of [false, true]) {
        const m = s.manifest;
        const r = route(s.graph, reverse ? m.defaultEnd : m.defaultStart, reverse ? m.defaultStart : m.defaultEnd, { ...ctx, profile });
        expect(r.status, `${id}/${profile}/${reverse}`).toBe('ok');
        if (r.status !== 'ok') continue;
        const edges = r.edgeIds.map(id => s.graph.edges.find(e => e.id === id)!);
        if (profile !== 'elderly') expect(edges.some(e => ['stairs', 'escalator'].includes(e.kind))).toBe(false);
        expect(segmentRoute(s.graph, r).some(s => s.type === 'floor')).toBe(true);
        expect(segmentRoute(s.graph, r).some(s => s.type === 'transition')).toBe(true);
        expect(r.distanceM).toBeGreaterThan(0);
        legs.set(`${id}/${profile}/${reverse}`, r);
      }
    }
    expect(route(s.graph, s.manifest.defaultStart, s.manifest.defaultEnd, { ...ctx, strictAccessibility: true }).status).toBe('no_route');
  }
  let pairs = 0;
  for (const from of ids) for (const to of ids) if (from !== to) {
    expect(legs.get(`${from}/wheelchair/false`).status).toBe('ok');
    expect(legs.get(`${to}/wheelchair/true`).status).toBe('ok');
    pairs++;
  }
  expect(pairs).toBe(132);
});
it('Kowloon Tong follows official indoor, lift and footbridge geometry', () => {
  const s = scene('kowloon-tong-festival-walk');
  const r = route(s.graph, s.manifest.defaultStart, s.manifest.defaultEnd, ctx);
  expect(segmentRoute(s.graph, r).map(s => s.type)).toEqual(['floor', 'transition', 'floor', 'outdoor', 'bridge']);
  expect(s.metadata.representation).toBe('network-centreline');
  expect(s.units.features).toHaveLength(0);
  expect(s.graph.edges.some(e => e.provenance === 'manual/demo augmentation')).toBe(false);
  if (r.status !== 'ok') throw new Error('Expected route');
  const lift = r.edgeIds.map(id => s.graph.edges.find(e => e.id === id)!).find(e => e.kind === 'lift')!;
  const changed = route(s.graph, s.manifest.defaultStart, s.manifest.defaultEnd, { ...ctx, events: [{id:'test-closure', type:'facility_closed', source:'demo', status:'active', validFrom:ctx.now, target:{facilityId:lift.facilityId}}] });
  if (changed.status === 'ok') expect(changed.edgeIds).not.toContain(lift.id);
  else expect(changed.reasonCodes).toContain('NO_ACCESSIBLE_ROUTE');
});
