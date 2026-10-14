import { describe, it, expect } from 'vitest';
import { route } from '../../shared/routing/route';
import { segmentRoute } from '../../shared/journey/segment';
import { defaultPolicies } from '../../shared/routing/policies';
import { fixture, ctx, scene, close } from '../fixtures';
describe('routing invariants', () => {
  it('wheelchair never takes the shorter stairs route', () => {
    const r = route(fixture(), 'start', 'end', ctx);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.edgeIds).toEqual(['s-a', 'a', 'a-t']);
  });
  it('stroller never uses stairs or escalators', () => {
    const g = fixture();
    g.edges[g.edges.length - 1].kind = 'escalator';
    const r = route(g, 'start', 'end', { ...ctx, profile: 'stroller' });
    if (r.status === 'ok') expect(r.edgeIds).not.toContain('stairs-edge');
    else throw Error('Expected route');
  });
  it('rejects unknown endpoints', () =>
    expect(() => route(fixture(), 'missing', 'end', ctx)).toThrow('Unknown'));
  it('supports start equals destination', () =>
    expect(route(fixture(), 'start', 'start', ctx)).toMatchObject({
      status: 'ok',
      distanceM: 0,
      edgeIds: [],
    }));
  it('honors one-way edges', () => {
    const g = fixture();
    g.edges.forEach((e) => (e.bidirectional = false));
    expect(route(g, 'end', 'start', ctx).status).toBe('no_route');
  });
  it('rejects negative plugin costs', () =>
    expect(() =>
      route(fixture(), 'start', 'end', ctx, [
        ...defaultPolicies,
        { id: 'bad', evaluate: () => ({ penalty: -1 }) },
      ]),
    ).toThrow('nonnegative'));
  it('strict mode rejects unknown access', () => {
    const g = fixture();
    g.edges.forEach((e) => (e.wheelchair = 'unknown'));
    expect(route(g, 'start', 'end', { ...ctx, strictAccessibility: true }).status).toBe('no_route');
  });
  it('strict mode allows only verified accessible edges', () => {
    const g = fixture();
    g.edges.forEach((e) => (e.wheelchair = 'verified_accessible'));
    expect(route(g, 'start', 'end', { ...ctx, strictAccessibility: true }).status).toBe('ok');
  });
  it('blocks verified inaccessible edges for step-free profiles', () => {
    const g = fixture();
    g.edges.find((e) => e.id === 'a')!.wheelchair = 'verified_inaccessible';
    const result = route(g, 'start', 'end', { ...ctx, objective: 'shortest' });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.edgeIds).not.toContain('a');
  });
  it('blocks temporarily unavailable edges for every profile', () => {
    const g = fixture();
    g.edges.forEach((e) => (e.wheelchair = 'temporarily_blocked'));
    expect(route(g, 'start', 'end', ctx).status).toBe('no_route');
    expect(route(g, 'start', 'end', { ...ctx, profile: 'walking' }).status).toBe('no_route');
  });
  it('replans from the current node instead of restarting the completed path', () => {
    const g = fixture();
    const remaining = route(g, 'a0', 'end', {
      ...ctx,
      events: [close('lift-a')],
    });
    expect(remaining.status).toBe('ok');
    if (remaining.status === 'ok') expect(remaining.nodeIds[0]).toBe('a0');
  });
  it('segments floors and transition without losing distance', () => {
    const g = fixture(),
      r = route(g, 'start', 'end', ctx),
      s = segmentRoute(g, r);
    expect(s.map((x) => x.type)).toEqual(['floor', 'transition', 'floor']);
    expect(s[1]).toMatchObject({ fromLevel: 'G', toLevel: 'L1', facilityId: 'lift-a' });
    expect(s.reduce((x, s) => x + s.distanceM, 0)).toBe(r.status === 'ok' ? r.distanceM : 0);
  });
  it('reverse route reverses geometry and level direction', () => {
    const g = fixture();
    g.edges[0].geometry = [
      [114, 22],
      [115, 23],
    ];
    const r = route(g, 'end', 'start', ctx),
      s = segmentRoute(g, r);
    expect(s[1]).toMatchObject({ fromLevel: 'L1', toLevel: 'G' });
    expect(s[2].geometry).toEqual([
      [115, 23],
      [114, 22],
    ]);
  });
  for (const id of ['hysan-place', 'popcorn-2']) {
    it(`${id}: real scene runs, reroutes and blocks both lifts`, () => {
      const s = scene(id),
        g = s.graph,
        m = s.manifest,
        copy = JSON.stringify(g);
      const r = route(g, m.defaultStart, m.defaultEnd, ctx);
      expect(r.status).toBe('ok');
      if (r.status !== 'ok') return;
      const lift = g.edges.find((e) => r.edgeIds.includes(e.id) && e.kind === 'lift')!;
      expect(lift).toBeDefined();
      const reroute = route(g, m.defaultStart, m.defaultEnd, {
        ...ctx,
        events: [close(lift.facilityId!)],
      });
      expect(reroute.status).toBe('ok');
      if (reroute.status === 'ok') expect(reroute.edgeIds).not.toContain(lift.id);
      expect(
        route(g, m.defaultStart, m.defaultEnd, {
          ...ctx,
          events: g.facilities.map((f) => close(f.id)),
        }).status,
      ).toBe('no_route');
      expect(JSON.stringify(g)).toBe(copy);
      expect(segmentRoute(g, r).map((s) => s.type)).toEqual([
        'floor',
        'transition',
        'floor',
        'outdoor',
      ]);
    });
  }
});
