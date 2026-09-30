import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { scene, ctx, fixture } from '../fixtures';
import {
  examples,
  validateResult,
  obstacleEvent,
  type IntegrationContext,
} from '../../shared/genai/contracts';
import { route } from '../../shared/routing/route';
import { segmentRoute } from '../../shared/journey/segment';
import { effectiveCost, defaultPolicies } from '../../shared/routing/policies';
import { createApp } from '../../backend/app';
const s = scene('hysan-place');
const initial = route(s.graph, s.manifest.defaultStart, s.manifest.defaultEnd, ctx);
const c: IntegrationContext = {
  version: '1.0',
  context_id: 'test-context',
  scene_id: s.manifest.sceneId,
  phase: 'planning',
  profile: 'wheelchair',
  preferences: null,
  current_node_id: s.manifest.defaultStart,
  destination_node_id: s.manifest.defaultEnd,
  segment: segmentRoute(s.graph, initial)[0],
  levels: s.manifest.levels,
  facilities: s.graph.facilities,
};
describe('GenAI integration contracts', () => {
  it('accepts all four generated examples with real graph references', () => {
    examples(c, s).forEach((e) => expect(validateResult(e, s)).toEqual(e));
  });
  it('rejects unsupported versions, unknown fields and invalid preferences', () => {
    const e = examples(c, s)[0];
    expect(() => validateResult({ ...e, version: '2.0' }, s)).toThrow();
    expect(() => validateResult({ ...e, extra: true }, s)).toThrow();
    expect(() =>
      validateResult({ ...e, payload: { ...e.payload, avoid_stairs: 'yes' } }, s),
    ).toThrow();
  });
  it('routes around a reported lift, returns no_route for both and restores resolved events', () => {
    const e = examples(c, s)[1];
    if (e.agent !== 'obstacle') throw Error();
    const first = obstacleEvent(validateResult(e, s) as typeof e);
    const second = obstacleEvent({
      ...e,
      payload: {
        ...e.payload,
        event_id: 'second',
        target: { facility_id: s.graph.facilities[1].id },
      },
    });
    const now = new Date().toISOString();
    const reroute = route(s.graph, c.current_node_id, c.destination_node_id, {
      ...ctx,
      now,
      events: [first],
    });
    expect(reroute.status).toBe('ok');
    if (reroute.status === 'ok')
      expect(
        reroute.edgeIds.some(
          (id) => s.graph.edges.find((e) => e.id === id)?.facilityId === first.target.facilityId,
        ),
      ).toBe(false);
    expect(
      route(s.graph, c.current_node_id, c.destination_node_id, {
        ...ctx,
        now,
        events: [first, second],
      }).status,
    ).toBe('no_route');
    expect(
      route(s.graph, c.current_node_id, c.destination_node_id, {
        ...ctx,
        now,
        events: [{ ...first, status: 'resolved' }, second],
      }).status,
    ).toBe('ok');
  });
  it('rejects invented target IDs, low confidence and reversed validity intervals', () => {
    const e = examples(c, s)[1];
    if (e.agent !== 'obstacle') throw Error();
    for (const patch of [
      { target: { facility_id: 'invented' } },
      { confidence: 0.4 },
      { valid_until: '2000-01-01T00:00:00Z' },
      { target: { edge_ids: ['invented'] } },
    ])
      expect(() => validateResult({ ...e, payload: { ...e.payload, ...patch } }, s)).toThrow();
  });
  it('requires node-floor agreement and treats outdoors as a non-positioning status', () => {
    const e = examples(c, s)[2];
    if (e.agent !== 'localization') throw Error();
    expect(() =>
      validateResult({ ...e, payload: { ...e.payload, level_id: 'wrong-floor' } }, s),
    ).toThrow();
    expect(() => validateResult({ ...e, payload: { ...e.payload, confidence: 0.2 } }, s)).toThrow();
    expect(
      validateResult(
        {
          ...e,
          payload: {
            is_indoor: false,
            status: 'outdoor_use_gps_directly',
            anchor_names: [],
            direction_hint: '',
            confidence: 0,
          },
        },
        s,
      ).agent,
    ).toBe('localization');
  });
  it('restricts guidance text length and rejects unsafe audio schemes', () => {
    const e = examples(c, s)[3];
    expect(() =>
      validateResult({ ...e, payload: { ...e.payload, text: '長'.repeat(61) } }, s),
    ).toThrow();
    for (const audio_url of [
      'javascript:alert(1)',
      'file:///tmp/a.wav',
      'http://remote.example/a.wav',
    ])
      expect(() => validateResult({ ...e, payload: { ...e.payload, audio_url } }, s)).toThrow();
  });
  it('honors added preferences without relaxing wheelchair restrictions', () => {
    const g = fixture();
    const stairs = g.edges.find((e) => e.kind === 'stairs')!;
    expect(
      effectiveCost(stairs, { ...ctx, profile: 'elderly', avoidStairs: true }, defaultPolicies)
        .cost,
    ).toBe(Infinity);
    expect(effectiveCost(stairs, { ...ctx, avoidStairs: false }, defaultPolicies).cost).toBe(
      Infinity,
    );
    const slope = { ...g.edges[0], slope: 0.12 };
    expect(
      effectiveCost(slope, { ...ctx, profile: 'elderly', avoidSteepSlopes: true }, defaultPolicies)
        .cost,
    ).toBe(Infinity);
    const outdoor = { ...g.edges[0], indoor: false, sheltered: false };
    expect(
      effectiveCost(outdoor, { ...ctx, preferCoveredShelter: true }, defaultPolicies).cost,
    ).toBe(outdoor.distanceM * 3);
  });
  it('HTTP validation never persists events and returns structured errors', async () => {
    const app = createApp();
    for (const e of examples(c, s)) {
      const r = await request(app).post('/api/genai/validate').send(e).expect(200);
      expect(r.body.applied).toBe(false);
    }
    expect((await request(app).get('/api/events')).body).toEqual([]);
    const e = examples(c, s)[0];
    expect(
      (
        await request(app)
          .post('/api/genai/validate')
          .send({ ...e, version: 'bad' })
          .expect(400)
      ).body.code,
    ).toBe('INVALID_PAYLOAD');
    await request(app)
      .post('/api/genai/validate')
      .send({ ...e, scene_id: 'missing' })
      .expect(404);
  });
});
