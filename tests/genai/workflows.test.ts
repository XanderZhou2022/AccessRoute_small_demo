import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createApp } from '../../backend/app';
import { scene, ctx } from '../fixtures';
import { route } from '../../shared/routing/route';
import { segmentRoute } from '../../shared/journey/segment';
import { obstacleEvent } from '../../shared/genai/contracts';
import { buildMapIndex } from '../../backend/retrieval/map-index';
import { rankCandidates, decision } from '../../backend/retrieval/rank';
import { QwenProvider } from '../../backend/providers/qwen';
import type { ModelProvider, ModelRequest } from '../../backend/providers/model';
import type { WorkflowContext, LandmarkRecord } from '../../shared/genai/workflows';
import type { Observation } from '../../backend/agents/vision';
const s = scene('hysan-place');
const start = s.graph.nodes.find((n) => n.id === s.manifest.defaultStart)!;
const next = s.graph.nodes.find((n) => n.levelId === start.levelId && n.id !== start.id)!;
const context: WorkflowContext = {
  context_id: 'workflow-test',
  scene_id: s.manifest.sceneId,
  current_node_id: start.id,
  destination_node_id: s.manifest.defaultEnd,
  phase: 'planning',
  routing: { ...ctx, now: new Date().toISOString() },
  preferences: null,
  segment_id: 'segment-0',
};
const image = 'data:image/jpeg;base64,YQ==';
const visual: Observation = {
  names: ['測試咖啡店'],
  text: ['測試咖啡店'],
  objects: [],
  floor_label: s.manifest.levels.find((l) => l.id === start.levelId)!.label,
  direction_hint: '店門旁',
  confidence: 0.97,
};
const preferences = {
  mobility_type: 'manual_wheelchair',
  avoid_stairs: true,
  avoid_steep_slopes: true,
  prefer_covered_shelter: true,
  tts_selection: 'cantonese_female',
};
class FixtureModel implements ModelProvider {
  calls: ModelRequest[] = [];
  observation: Observation = visual;
  barrier = { has_obstacle: true, type: 'broken_lift', evidence: '維修中', confidence: 0.94 };
  async json(input: ModelRequest): Promise<unknown> {
    this.calls.push(input);
    if (input.task === 'preferences') return preferences;
    if (input.task === 'localization-observation') return this.observation;
    if (input.task === 'obstacle-observation')
      return { ...this.observation, barrier: this.barrier };
    if (input.task === 'guidance')
      return { text: '請跟住畫面路線慢慢行，到下一個位置再按已到達。' };
    const { candidates, observation } = input.input as {
      candidates: { id: string; names: string[]; descriptions: string[] }[];
      observation: Observation;
    };
    return {
      matches: candidates.map((candidate) => ({
        candidate_id: candidate.id,
        evidence: [...observation.names, ...observation.objects].flatMap((observed) =>
          [...candidate.names, ...candidate.descriptions]
            .filter((mapped) => observed === mapped)
            .map((mapped) => ({ observed, mapped })),
        ),
      })),
    };
  }
}
async function directory(records: LandmarkRecord[]) {
  const root = await mkdtemp(tmpdir() + '/accessroute-landmarks-');
  await writeFile(`${root}/${s.manifest.sceneId}.json`, JSON.stringify(records));
  return root;
}
const landmark = (id: string, node_id = start.id): LandmarkRecord => ({
  id,
  scene_id: s.manifest.sceneId,
  node_id,
  level_id: start.levelId,
  names: ['測試咖啡店'],
  category: 'shop',
  descriptions: ['粉紅色招牌'],
  source: 'test fixture only',
});
describe('four map-grounded workflows', () => {
  let model: FixtureModel;
  beforeEach(() => {
    model = new FixtureModel();
  });
  it('parses preferences and leaves event application to the caller', async () => {
    const app = createApp({ model });
    const response = await request(app)
      .post('/api/genai/workflows/preferences')
      .send({ context, text: '我坐輪椅，想有蓋通道' })
      .expect(200);
    expect(response.body.result.payload).toEqual(preferences);
    expect(response.body.trace.map((t: { step: string }) => t.step)).toEqual([
      'intent-agent',
      'routing-policy',
    ]);
    expect((await request(app).get('/api/events')).body).toEqual([]);
    expect(model.calls.map((c) => c.task)).toEqual(['preferences']);
  });
  it('localizes from a real directory node using observation then matching, without caller supplying the answer', async () => {
    const app = createApp({ model, landmarkRoot: await directory([landmark('test-shop')]) });
    const response = await request(app)
      .post('/api/genai/workflows/localization')
      .send({ context, image })
      .expect(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.result.payload.map_db_node_id).toBe(start.id);
    expect(response.body.result.payload.level_id).toBe(start.levelId);
    expect(model.calls.map((c) => c.task)).toEqual(['localization-observation', 'map-matching']);
    expect(JSON.stringify(model.calls[1].input)).not.toContain(image);
    expect(
      route(s.graph, response.body.result.payload.map_db_node_id, context.destination_node_id, ctx)
        .status,
    ).toBe('ok');
  });
  it('uses mapped visual descriptions when OCR cannot read a shop name', async () => {
    model.observation = { ...visual, names: [], text: [], objects: ['粉紅色招牌'] };
    const app = createApp({ model, landmarkRoot: await directory([landmark('test-shop')]) });
    const response = await request(app)
      .post('/api/genai/workflows/localization')
      .send({ context, image })
      .expect(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.result.payload.map_db_node_id).toBe(start.id);
    expect(response.body.candidates[0].evidence).toContain('粉紅色招牌 ↔ 粉紅色招牌');
  });
  it('ambiguous shops require a consumable confirmation and preserve the score', async () => {
    const app = createApp({
      model,
      landmarkRoot: await directory([landmark('shop-a'), landmark('shop-b', next.id)]),
    });
    const response = await request(app)
      .post('/api/genai/workflows/localization')
      .send({ context, image })
      .expect(200);
    expect(response.body.status).toBe('needs_confirmation');
    expect(response.body.result).toBeNull();
    const id = response.body.confirmation_id;
    await request(app)
      .post('/api/genai/confirm')
      .send({
        context: { ...context, context_id: 'stale' },
        confirmation_id: id,
        candidate_id: 'shop-a',
      })
      .expect(400);
    await request(app)
      .post('/api/genai/confirm')
      .send({ context, confirmation_id: id, candidate_id: 'invented' })
      .expect(400);
    const confirmed = await request(app)
      .post('/api/genai/confirm')
      .send({ context, confirmation_id: id, candidate_id: 'shop-a' })
      .expect(200);
    expect(confirmed.body.result.payload.match_method).toBe('user_confirmed');
    expect(confirmed.body.result.payload.confidence).toBe(
      response.body.candidates.find((c: { id: string }) => c.id === 'shop-a').score,
    );
    expect(model.calls).toHaveLength(2);
    await request(app)
      .post('/api/genai/confirm')
      .send({ context, confirmation_id: id, candidate_id: 'shop-a' })
      .expect(400);
  });
  it('low observation confidence stays low, with explicit confirmation as the alternative', async () => {
    model.observation = { ...visual, confidence: 0.4 };
    const app = createApp({ model, landmarkRoot: await directory([landmark('shop')]) });
    const response = await request(app)
      .post('/api/genai/workflows/localization')
      .send({ context, image })
      .expect(200);
    expect(response.body.status).toBe('needs_confirmation');
    expect(response.body.candidates[0].score).toBe(0.4);
    const confirmed = await request(app)
      .post('/api/genai/confirm')
      .send({ context, confirmation_id: response.body.confirmation_id, candidate_id: 'shop' })
      .expect(200);
    expect(confirmed.body.result.payload.confidence).toBe(0.4);
  });
  it('an unknown floor and an out-of-scene GPS produce no match', async () => {
    const app = createApp({ model });
    model.observation = { ...visual, floor_label: '99/F' };
    expect(
      (
        await request(app)
          .post('/api/genai/workflows/localization')
          .send({ context, image })
          .expect(200)
      ).body.status,
    ).toBe('no_match');
    model.observation = visual;
    expect(
      (
        await request(app)
          .post('/api/genai/workflows/localization')
          .send({ context, image, position: { lat: 0, lon: 0, accuracy_m: 5 } })
          .expect(200)
      ).body.status,
    ).toBe('no_match');
    expect(model.calls.every((c) => c.task !== 'map-matching')).toBe(true);
  });
  it('matches a photographed lift then applies the event through the map API and reroutes', async () => {
    const initial = route(s.graph, context.current_node_id, context.destination_node_id, ctx);
    const liftSegment = segmentRoute(s.graph, initial).find((segment) => segment.facilityId)!;
    const liftNode = s.graph.nodes.find((n) => n.id === liftSegment.nodeIds[0])!;
    const facility = s.graph.facilities.find((f) => f.id === liftSegment.facilityId)!;
    model.observation = {
      ...visual,
      names: [facility.label],
      text: [facility.label, '維修中'],
      floor_label: s.manifest.levels.find((l) => l.id === liftNode.levelId)!.label,
    };
    const app = createApp({ model, allowWrites: true });
    const local = { ...context, current_node_id: liftNode.id };
    const response = await request(app)
      .post('/api/genai/workflows/obstacle')
      .send({ context: local, image })
      .expect(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.result.payload.target.facility_id).toBe(facility.id);
    expect((await request(app).get('/api/events')).body).toEqual([]);
    const event = obstacleEvent(response.body.result);
    await request(app).post('/api/events').send(event).expect(201);
    const changed = await request(app)
      .post('/api/route')
      .send({
        sceneId: s.manifest.sceneId,
        from: liftNode.id,
        to: context.destination_node_id,
        context: { ...ctx, now: new Date().toISOString() },
      })
      .expect(200);
    expect(changed.body.route.status).toBe('ok');
    expect(
      changed.body.route.edgeIds.some(
        (id: string) => s.graph.edges.find((e) => e.id === id)?.facilityId === facility.id,
      ),
    ).toBe(false);
    expect(response.body.result.payload.confidence).toBeLessThanOrEqual(0.94);
  });
  it('does not resolve an old event just because a photo shows no visible barrier', async () => {
    model.barrier = {
      has_obstacle: false,
      type: 'none',
      evidence: '',
      confidence: 0.9,
    };
    const app = createApp({ model });
    const response = await request(app)
      .post('/api/genai/workflows/obstacle')
      .send({ context, image })
      .expect(200);
    expect(response.body.result).toBeNull();
    expect(model.calls).toHaveLength(1);
  });
  it('a path barrier can be confirmed against retrieved edges without an invented target', async () => {
    model.observation = { ...visual, names: [], text: [], objects: ['走廊 corridor'] };
    model.barrier = {
      has_obstacle: true,
      type: 'construction',
      evidence: '工程擋板',
      confidence: 0.9,
    };
    const app = createApp({ model, allowWrites: true });
    // The fixture matcher can cite the path description; generic corridors remain ambiguous.
    const response = await request(app)
      .post('/api/genai/workflows/obstacle')
      .send({ context, image })
      .expect(200);
    expect(response.body.status).toBe('needs_confirmation');
    const candidate = response.body.candidates[0];
    const confirmed = await request(app)
      .post('/api/genai/confirm')
      .send({ context, confirmation_id: response.body.confirmation_id, candidate_id: candidate.id })
      .expect(200);
    expect(
      confirmed.body.result.payload.target.edge_ids.every((id: string) =>
        s.graph.edges.some((e) => e.id === id),
      ),
    ).toBe(true);
    await request(app).post('/api/events').send(obstacleEvent(confirmed.body.result)).expect(201);
  });
  it('builds voice guidance from server route facts and honors text-only preference', async () => {
    const app = createApp({ model });
    const response = await request(app)
      .post('/api/genai/workflows/guidance')
      .send({
        context: { ...context, preferences: { ...preferences, tts_selection: 'text_only' } },
      })
      .expect(200);
    expect(response.body.speech.selection).toBe('text_only');
    expect(response.body.result.payload.segment_id).toBe('segment-0');
    expect(model.calls[0].task).toBe('guidance');
    expect(
      (model.calls[0].input as { route_facts: { distance_m: number } }).route_facts.distance_m,
    ).toBeGreaterThan(0);
    await request(app)
      .post('/api/genai/workflows/guidance')
      .send({ context: { ...context, segment_id: null } })
      .expect(400);
  });
  it('rejects invalid map endpoints before invoking a model', async () => {
    const app = createApp({ model });
    await request(app)
      .post('/api/genai/workflows/preferences')
      .send({ context: { ...context, current_node_id: 'invented' }, text: '輪椅' })
      .expect(400);
    await request(app)
      .post('/api/genai/workflows/localization')
      .send({ context, image: 'not-an-image' })
      .expect(400);
    expect(model.calls).toHaveLength(0);
  });
  it('ranks without accepting invented map evidence or unrelated IDs', () => {
    const index = buildMapIndex(s, [landmark('shop')]);
    const candidate = { ...index[0], distance_m: 0, route_distance_m: 0 };
    const obs = { ...visual, names: [], text: [], objects: [] };
    const ranked = rankCandidates(
      obs,
      [candidate],
      [
        {
          candidate_id: 'shop',
          evidence: [
            { observed: '虛構店名', mapped: '測試咖啡店' },
            { observed: ' ', mapped: ' ' },
          ],
        },
      ],
    );
    expect(ranked[0].evidence).toEqual([]);
    expect(ranked[0].score).toBe(0.15);
    expect(decision(ranked, 'localization')).toBe('no_match');
  });
});
describe('Qwen API transport', () => {
  it('keeps credentials server-side and selects vision model only for photos', async () => {
    const requests: {
      url: string;
      body: Record<string, unknown>;
      headers: HeadersInit | undefined;
    }[] = [];
    const send: typeof fetch = async (url, options) => {
      requests.push({
        url: String(url),
        body: JSON.parse(options!.body as string),
        headers: options!.headers,
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
        status: 200,
      });
    };
    const provider = new QwenProvider(
      {
        apiKey: 'test-key',
        baseUrl: 'https://example.invalid/v1/',
        textModel: 'text',
        visionModel: 'vision',
      },
      send,
    );
    await provider.json({ task: 'preferences', system: 'JSON', input: { text: '輪椅' } });
    await provider.json({ task: 'localization-observation', system: 'JSON', input: {}, image });
    expect(requests.map((r) => r.body.model)).toEqual(['text', 'vision']);
    expect(requests[0].url).toBe('https://example.invalid/v1/chat/completions');
    expect(requests[0].body.response_format).toEqual({ type: 'json_object' });
    expect(JSON.stringify(requests[0].body)).not.toContain('test-key');
  });
  it('reports missing configuration and provider errors instead of fake successes', async () => {
    const provider = new QwenProvider({
      apiKey: '',
      baseUrl: 'x',
      textModel: 'text',
      visionModel: 'vision',
    });
    await expect(
      provider.json({ task: 'preferences', system: 'JSON', input: {} }),
    ).rejects.toMatchObject({ code: 'MODEL_NOT_CONFIGURED' });
    const unavailable = new QwenProvider(
      {
        apiKey: 'test',
        baseUrl: 'https://example.invalid',
        textModel: 'text',
        visionModel: 'vision',
      },
      async () => new Response('', { status: 429 }),
    );
    await expect(
      unavailable.json({ task: 'preferences', system: 'JSON', input: {} }),
    ).rejects.toMatchObject({ code: 'MODEL_API_ERROR' });
  });
});
