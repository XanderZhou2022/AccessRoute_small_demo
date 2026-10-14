import { it, expect } from 'vitest';
import { graphSchema, validateScene, manifestSchema, type Scene } from '../../shared/domain/schema';
import { StaticSceneDataProvider, HttpSceneDataProvider } from '../../shared/providers';
import { fixture, ctx, scene } from '../fixtures';
import { route } from '../../shared/routing/route';
import { segmentRoute } from '../../shared/journey/segment';
it('third scene loads without routing or renderer changes', () => {
  const graph = fixture(),
    empty = { type: 'FeatureCollection' as const, features: [] };
  const third = validateScene({
    manifest: {
      ...scene('hysan-place').manifest,
      sceneId: 'third-scene',
      venueId: 'v',
      entryPoints: ['start', 'end'],
      defaultStart: 'start',
      defaultEnd: 'end',
      levels: [
        { id: 'G', label: 'G', z: 0 },
        { id: 'L1', label: '1', z: 4 },
      ],
    },
    graph,
    levels: empty,
    units: empty,
    openings: empty,
    amenities: empty,
    surroundings: empty,
    metadata: {},
  });
  expect(route(third.graph, 'start', 'end', ctx).status).toBe('ok');
});
it.each(['duplicate', 'dangling', 'negative', 'cross-floor'])(
  'rejects malformed graph: %s',
  (kind) => {
    const g = fixture();
    if (kind === 'duplicate') g.nodes.push(g.nodes[0]);
    if (kind === 'dangling') g.edges[0].to = 'bad';
    if (kind === 'negative') g.edges[0].distanceM = -1;
    if (kind === 'cross-floor') g.edges[0].to = 'end';
    expect(() => graphSchema.parse(g)).toThrow();
  },
);
it('manifest files cannot escape scene directory', () => {
  const m = scene('hysan-place').manifest;
  m.files.graph = '../secrets.json';
  expect(() => manifestSchema.parse(m)).toThrow();
});
it('static and HTTP provider produce identical navigation output', async () => {
  const s = scene('hysan-place');
  const mock = async (input: RequestInfo | URL) => {
    const url = String(input);
    let data: unknown;
    if (url.endsWith('/api/scenes/hysan-place')) data = s;
    else if (url.endsWith('/api/scenes')) data = [s.manifest];
    else if (url.endsWith('/index.json')) data = { scenes: ['hysan-place'] };
    else if (url.endsWith('/manifest.json')) data = s.manifest;
    else {
      const key = Object.entries(s.manifest.files).find(([, v]) => url.endsWith('/' + v))![0];
      data = s[key as keyof Scene];
    }
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  };
  const a = new StaticSceneDataProvider('/data', mock),
    b = new HttpSceneDataProvider('/api', mock);
  expect(await a.list()).toEqual(await b.list());
  const [sa, sb] = await Promise.all([a.load('hysan-place'), b.load('hysan-place')]);
  const navigate = (s: Scene) =>
    segmentRoute(s.graph, route(s.graph, s.manifest.defaultStart, s.manifest.defaultEnd, ctx));
  expect(navigate(sa)).toEqual(navigate(sb));
});
