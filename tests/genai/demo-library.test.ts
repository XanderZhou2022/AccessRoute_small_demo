import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { scene } from '../fixtures';
import { applyDemoOverlay, applyDemoResult, demoRoute } from '../../shared/demo/navigation';
import { ExampleWorkflowClient } from '../../shared/demo/provider';
import { searchKnowledge } from '../../shared/demo/knowledge';
import { rankCandidates, decision } from '../../backend/retrieval/rank';
import type { DemoCase, DemoOverlay, DemoMedia, KnowledgeRecord } from '../../shared/demo/types';
import request from 'supertest';
import { createApp } from '../../backend/app';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const index = read('data/demo/index.json');
const overlays: DemoOverlay[] = read('data/demo/overlays.json');
const scenes = new Map(overlays.map((o) => [o.scene_id, applyDemoOverlay(scene(o.scene_id), o)]));
const cases: DemoCase[] = index.cases.map((c: { id: string }) =>
  read(`data/demo/cases/${c.id}.json`),
);

describe('offline story library', () => {
  it('contains four complete personas for all 12 scenes and licensed local image references', () => {
    expect(cases).toHaveLength(48);
    const media: DemoMedia[] = index.media;
    expect(
      new Set(media.filter((m) => m.kind === 'historical_photo').map((m) => m.scene_id)).size,
    ).toBe(12);
    for (const m of media) {
      expect(existsSync(`data/demo/${m.path}`), m.id).toBe(true);
      if (m.kind === 'historical_photo') {
        expect(m.source_url).toMatch(/^https:\/\/commons.wikimedia.org\//);
        expect(m.license).toMatch(/CC BY|CC0|Public domain/);
        expect(m.author).not.toBe('');
        expect(m.camera_node_id).toBeNull();
      }
    }
    for (const id of scenes.keys())
      expect(cases.filter((c) => c.origin_scene_id === id)).toHaveLength(4);
  });

  it('replays every agent response through the common result contract and reproduces all route snapshots', async () => {
    for (const example of cases) {
      for (let i = 0; i < example.steps.length; i++) {
        const step = example.steps[i],
          s = scenes.get(step.state.scene_id)!;
        expect(demoRoute(s, step.state), `${example.id}/${step.id}`).toEqual(step.route);
        if (step.id !== 'fault')
          expect(step.route.result.status, `${example.id}/${step.id}`).toBe('ok');
        expect(step.agent_records.some((r) => r.source === 'computed')).toBe(true);
        if (step.response) {
          const ctx = { ...step.context, context_id: 'fresh-offline-context' };
          const response = await new ExampleWorkflowClient(example, step.id).run(
            step.response.workflow,
            ctx,
          );
          expect(response.result!.context_id).toBe(ctx.context_id);
          let state = applyDemoResult(
            scenes.get(step.context.scene_id)!,
            i ? example.steps[i - 1].state : example.initial_state,
            response.result!,
          );
          if (step.id === 'rain') state = { ...state, routing: { ...state.routing, rain: true } };
          expect(state, `${example.id}/${step.id}/consumer`).toEqual(step.state);
        }
        if (step.route.result.status === 'ok') {
          const edges = step.route.result.edgeIds.map((id) =>
            s.graph.edges.find((e) => e.id === id)!,
          );
          if (step.state.policy_mode === 'accessible')
            expect(edges.some((e) => e.kind === 'stairs')).toBe(false);
          const closed = step.state.routing.events
            .filter((e) => e.status === 'active')
            .map((e) => e.target.facilityId);
          expect(edges.some((e) => e.facilityId && closed.includes(e.facilityId))).toBe(false);
        }
      }
      const arrival = example.steps.at(-1)!;
      expect(arrival.state.current_node_id).toBe(arrival.state.destination_node_id);
      expect(arrival.route.result.status === 'ok' && arrival.route.result.distanceM).toBe(0);
    }
  });

  it('demonstrates accessible reroutes, covered rain alternatives, and lift-free fault detours', () => {
    expect(cases.every((c) => c.steps.find((s) => s.id === 'preferences')!.route_changed)).toBe(
      true,
    );
    const rain = cases.filter((c) => c.steps.find((s) => s.id === 'rain')!.route_changed);
    expect(rain.length).toBeGreaterThan(0);
    for (const c of rain)
      expect(c.steps.find((s) => s.id === 'rain')!.route.exposed_m).toBeLessThan(
        c.steps.find((s) => s.id === 'preferences')!.route.exposed_m,
      );
    expect(
      cases.every((c) => c.steps.find((s) => s.id === 'fault')!.route.result.status === 'ok'),
    ).toBe(true);
    for (const overlay of overlays)
      for (const edge of overlay.edges) {
        expect(edge.provenance).toBe('manual/demo augmentation');
        expect(edge.tags?.demo_assumption).toBe(true);
        expect(scene(overlay.scene_id).graph.edges.some((e) => e.id === edge.id)).toBe(false);
      }
  });

  it('rejects a recorded answer for a different map context', async () => {
    const example = cases[0],
      step = example.steps.find((s) => s.id === 'preferences')!;
    await expect(
      new ExampleWorkflowClient(example, step.id).run('preferences', {
        ...step.context,
        scene_id: 'popcorn-2',
      }),
    ).rejects.toThrow('上下文不一致');
  });

  it('repeated route segmentation preserves the original geometry arrays', () => {
    const c = cases.find((c) => c.origin_scene_id === 'kowloon-tong-festival-walk')!;
    const s = scenes.get(c.origin_scene_id)!;
    const before = JSON.stringify(s.graph);
    const first = demoRoute(s, c.steps[2].state);
    expect(demoRoute(s, c.steps[2].state)).toEqual(first);
    expect(JSON.stringify(s.graph)).toBe(before);
  });

  it('retrieves actual shop names and keeps approximate anchors below automatic acceptance', () => {
    const records: KnowledgeRecord[] = read('data/knowledge/hysan-place.json').records;
    const apple = searchKnowledge(records, 'Apple')[0].record;
    expect(apple.names.join(' ')).toContain('Apple');
    expect(apple.verified_url).toContain('apple.com');
    for (const r of records.filter((r) => r.node_id)) {
      const node = scenes.get(r.scene_id)!.graph.nodes.find((n) => n.id === r.node_id)!;
      expect(node.levelId).toBe(r.level_id);
      expect(r.association_distance_m!).toBeLessThanOrEqual(20);
    }
    const observation = {
      names: ['Apple'],
      text: ['Apple'],
      objects: [],
      floor_label: null,
      direction_hint: '',
      confidence: 0.99,
    };
    const candidate = {
      id: apple.id,
      names: ['Apple'],
      category: 'shop',
      descriptions: [],
      source: apple.source,
      association: 'approximate' as const,
      node_id: apple.node_id!,
      level_id: apple.level_id,
      lon: apple.lon,
      lat: apple.lat,
      distance_m: 0,
      route_distance_m: 0,
    };
    const ranked = rankCandidates(
      observation,
      [candidate],
      [{ candidate_id: apple.id, evidence: [{ observed: 'Apple', mapped: 'Apple' }] }],
    );
    expect(ranked[0].score).toBe(0.79);
    expect(decision(ranked, 'localization')).toBe('needs_confirmation');
  });

  it('serves official knowledge independently of model calls and exposes shop candidates to the workflows', async () => {
    const app = createApp({
      model: {
        json: async () => {
          throw new Error('Knowledge lookup must not call a model');
        },
      },
    });
    const response = await request(app).get('/api/knowledge/popcorn-2?q=KFC').expect(200);
    expect(
      response.body.results.some((r: any) => /KFC|肯德基/.test(r.record.names.join(' '))),
    ).toBe(true);
    const { SceneRepository } = await import('../../backend/repositories/scenes');
    const repository = new SceneRepository('data/scenes', 'data/landmarks', 'data/knowledge');
    const landmarks = await repository.landmarks(await repository.load('hysan-place'));
    expect(
      landmarks.some(
        (r) => r.names.some((name) => name.includes('Apple')) && r.association === 'approximate',
      ),
    ).toBe(true);
  });
});
