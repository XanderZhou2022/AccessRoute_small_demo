import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fixture, ctx, close, scene } from '../fixtures';
import { route, planRoutes } from '../../shared/routing/route';
import { applyDemoOverlay } from '../../shared/demo/navigation';
import { createApp } from '../../backend/app';
import { buildMapIndex } from '../../backend/retrieval/map-index';
import { validateResult, obstacleEvent } from '../../shared/genai/contracts';
import { applyRoutingPreferences } from '../../shared/routing/preferences';
import type { DemoOverlay } from '../../shared/demo/types';

const overlays: DemoOverlay[] = JSON.parse(readFileSync('data/demo/overlays.json', 'utf8'));
function withRamp() {
  const graph = fixture();
  graph.facilities.push({ id: 'ramp', kind: 'ramp', label: 'Ramp', sourceRefs: [] });
  graph.edges.push({
    ...graph.edges[1],
    id: 'ramp',
    from: 'start',
    to: 'end',
    kind: 'ramp',
    facilityId: 'ramp',
    distanceM: 30,
    slope: 0.05,
    widthM: 1.4,
    indoor: true,
  });
  return graph;
}
const allLiftsClosed = { ...ctx, events: [close('lift-a'), close('lift-b')] };

describe('capabilities and multiple routing objectives', () => {
  it('a wheelchair uses a ramp after every lift closes, even with allowStairs=true', () => {
    expect(
      route(withRamp(), 'start', 'end', { ...allLiftsClosed, allowStairs: true }),
    ).toMatchObject({ status: 'ok', edgeIds: ['ramp'] });
  });
  it.each(['walking', 'elderly', 'heavy_luggage', 'stroller'] as const)(
    '%s can explicitly permit stairs',
    (profile) => {
      expect(
        route(fixture(), 'start', 'end', {
          ...allLiftsClosed,
          profile,
          allowStairs: true,
          objective: 'shortest',
        }),
      ).toMatchObject({ status: 'ok', edgeIds: ['stairs-edge'] });
      expect(
        route(fixture(), 'start', 'end', {
          ...allLiftsClosed,
          profile,
          allowStairs: true,
          avoidStairs: true,
        }).status,
      ).toBe('no_route');
    },
  );
  it('escalators have their own capability and obey direction', () => {
    const graph = fixture();
    const escalator = graph.edges.at(-1)!;
    escalator.kind = 'escalator';
    escalator.bidirectional = false;
    const context = {
      ...allLiftsClosed,
      profile: 'walking' as const,
      allowStairs: false,
      avoidStairs: true,
      allowEscalators: true,
    };
    expect(route(graph, 'start', 'end', context).status).toBe('ok');
    expect(route(graph, 'end', 'start', context).status).toBe('no_route');
    expect(route(graph, 'start', 'end', { ...context, allowEscalators: false }).status).toBe(
      'no_route',
    );
  });
  it('avoiding lifts selects another cross-level mode', () => {
    expect(route(withRamp(), 'start', 'end', { ...ctx, avoidLifts: true })).toMatchObject({
      status: 'ok',
      edgeIds: ['ramp'],
    });
  });
  it('slope, width, stair flight limits and opening hours are hard constraints', () => {
    const graph = withRamp();
    expect(route(graph, 'start', 'end', { ...allLiftsClosed, maxSlope: 0.04 }).status).toBe(
      'no_route',
    );
    expect(route(graph, 'start', 'end', { ...allLiftsClosed, minWidthM: 1.5 }).status).toBe(
      'no_route',
    );
    graph.edges.at(-1)!.openUntil = '2020-01-01T00:00:00Z';
    expect(route(graph, 'start', 'end', allLiftsClosed).status).toBe('no_route');
    const stairs = fixture();
    stairs.edges.at(-1)!.stepCount = 12;
    expect(
      route(stairs, 'start', 'end', {
        ...allLiftsClosed,
        profile: 'walking',
        maxStepsPerFlight: 10,
      }).status,
    ).toBe('no_route');
  });
  it('rain minimises exposure even when the covered detour is more than three times longer', () => {
    const graph = fixture();
    graph.edges.filter((e) => e.kind === 'lift').forEach((e) => (e.indoor = true));
    graph.edges
      .filter((e) => ['s-a', 'a-t'].includes(e.id))
      .forEach((e) => {
        e.indoor = false;
        e.distanceM = 1;
      });
    graph.edges
      .filter((e) => ['s-b', 'b-t'].includes(e.id))
      .forEach((e) => {
        e.indoor = true;
        e.distanceM = 100;
      });
    const rainy = route(graph, 'start', 'end', { ...ctx, rain: true, objective: 'balanced' });
    expect(rainy).toMatchObject({ edgeIds: ['s-b', 'b', 'b-t'], metrics: { exposedM: 0 } });
    expect(
      route(graph, 'start', 'end', { ...ctx, rain: true, objective: 'shortest' }),
    ).toMatchObject({ edgeIds: ['s-a', 'a', 'a-t'] });
    graph.edges.find((e) => e.id === 's-a')!.sheltered = true;
    graph.edges.find((e) => e.id === 'a-t')!.sheltered = true;
    expect(route(graph, 'start', 'end', { ...ctx, objective: 'sheltered' })).toMatchObject({
      edgeIds: ['s-a', 'a', 'a-t'],
    });
    expect(route(graph, 'start', 'end', { ...ctx, objective: 'indoor' })).toMatchObject({
      edgeIds: ['s-b', 'b', 'b-t'],
    });
  });
  it('fastest accounts for facility waiting time and alternatives stay feasible and unique', () => {
    const graph = withRamp();
    graph.edges.filter((e) => e.kind === 'lift').forEach((e) => (e.waitS = 600));
    const fast = route(graph, 'start', 'end', { ...ctx, objective: 'fastest' });
    expect(fast).toMatchObject({ edgeIds: ['ramp'] });
    const plans = planRoutes(graph, 'start', 'end', ctx);
    expect(plans.length).toBeGreaterThan(1);
    expect(new Set(plans.map((p) => p.route.edgeIds.join('|'))).size).toBe(plans.length);
    expect(plans.every((p) => !p.route.edgeIds.includes('stairs-edge'))).toBe(true);
  });
  it('all scene scenarios can route without a lift for every profile', () => {
    for (const overlay of overlays) {
      const s = applyDemoOverlay(scene(overlay.scene_id), overlay);
      for (const profile of [
        'wheelchair',
        'walking',
        'elderly',
        'stroller',
        'heavy_luggage',
      ] as const) {
        const result = route(s.graph, s.manifest.defaultStart, s.manifest.defaultEnd, {
          ...ctx,
          profile,
          avoidLifts: true,
          rain: true,
        });
        expect(result.status, `${overlay.scene_id}/${profile}`).toBe('ok');
        if (result.status === 'ok')
          expect(
            result.edgeIds.every((id) => s.graph.edges.find((e) => e.id === id)!.kind !== 'lift'),
          ).toBe(true);
      }
    }
  });
  it('all blocked cross-level connections return no_route instead of violating capability', () => {
    const graph = withRamp();
    expect(
      route(graph, 'start', 'end', {
        ...allLiftsClosed,
        events: [...allLiftsClosed.events, close('ramp')],
      }).status,
    ).toBe('no_route');
  });
  it('the shared preference consumer applies model fields to the same planner', () => {
    const parsed = applyRoutingPreferences(ctx, {
      mobility_type: 'heavy_luggage',
      avoid_stairs: false,
      avoid_steep_slopes: true,
      prefer_covered_shelter: true,
      tts_selection: 'text_only',
      route_objective: 'indoor',
      avoid_lifts: true,
      max_slope: 0.05,
      min_width_m: 1.2,
      allow_escalators: false,
    });
    expect(parsed).toMatchObject({
      allowStairs: true,
      allowEscalators: false,
      objective: 'indoor',
      avoidLifts: true,
      maxSlope: 0.05,
      minWidthM: 1.2,
    });
  });
  it('indexes and closes a ramp facility even when its endpoints are shared with a lift', () => {
    const overlay = overlays.find((o) => o.scene_id === 'hysan-place')!;
    const s = applyDemoOverlay(scene('hysan-place'), overlay);
    const candidate = buildMapIndex(s, []).find((c) => c.category === 'ramp' && c.facility_id)!;
    expect(candidate.facility_id).toBeDefined();
    const result = validateResult(
      {
        version: '1.0',
        request_id: 'ramp-fault',
        context_id: 'ramp-context',
        scene_id: s.manifest.sceneId,
        agent: 'obstacle',
        payload: {
          event_id: 'ramp-fault',
          has_obstacle: true,
          barrier_type: 'facility_closed',
          location_sign: '坡道維修中',
          is_indoor: true,
          target: { facility_id: candidate.facility_id },
          confidence: 0.95,
          valid_from: ctx.now,
          valid_until: '2027-01-01T00:00:00Z',
        },
      },
      s,
    );
    if (result.agent !== 'obstacle') throw new Error('Expected obstacle');
    const event = obstacleEvent(result);
    expect(event.type).toBe('facility_closed');
    expect(
      route(s.graph, s.manifest.defaultStart, s.manifest.defaultEnd, {
        ...ctx,
        avoidLifts: true,
        events: [event],
      }).status,
    ).toBe('no_route');
  });
  it('route API exposes the same scenario, metrics and candidate routes without a model call', async () => {
    const s = scene('hysan-place');
    const app = createApp();
    const response = await request(app)
      .post('/api/route')
      .send({
        sceneId: s.manifest.sceneId,
        from: s.manifest.defaultStart,
        to: s.manifest.defaultEnd,
        context: { ...ctx, graphMode: 'scenario', avoidLifts: true, rain: true },
      })
      .expect(200);
    expect(response.body.route.status).toBe('ok');
    expect(response.body.route.metrics).toHaveProperty('exposedM');
    expect(response.body.segments.some((s: { mode: string }) => s.mode === 'ramp')).toBe(true);
    expect(response.body.alternatives.length).toBeGreaterThan(0);
    const loaded = await request(app).get('/api/scenes/hysan-place?mode=scenario').expect(200);
    expect(loaded.body.graph.edges.some((e: { kind: string }) => e.kind === 'ramp')).toBe(true);
  });
});
