import { applyRoutingPreferences } from '../routing/preferences';
import { graphSchema, type Scene } from '../domain/schema';
import { validateResult, obstacleEvent, type AgentResult } from '../genai/contracts';
import { route } from '../routing/route';
import { segmentRoute } from '../journey/segment';
import type { DemoState, DemoRouteSnapshot, DemoOverlay } from './types';
import { eventPolicy, weatherPolicy } from '../routing/policies';

export function applyDemoOverlay(scene: Scene, overlay: DemoOverlay): Scene {
  if (scene.manifest.sceneId !== overlay.scene_id) throw new Error('演示圖層場景不符');
  return {
    ...scene,
    graph: graphSchema.parse({
      ...scene.graph,
      edges: [...scene.graph.edges, ...overlay.edges],
      facilities: [...scene.graph.facilities, ...overlay.facilities],
    }),
  };
}

export function demoRoute(scene: Scene, state: DemoState): DemoRouteSnapshot {
  const result =
    state.policy_mode === 'distance_only'
      ? route(scene.graph, state.current_node_id, state.destination_node_id, state.routing, [
          eventPolicy,
          weatherPolicy,
        ])
      : route(scene.graph, state.current_node_id, state.destination_node_id, state.routing);
  const edges =
    result.status === 'ok'
      ? result.edgeIds.map((id) => scene.graph.edges.find((e) => e.id === id)!)
      : [];
  return {
    result,
    segments: segmentRoute(scene.graph, result),
    exposed_m: edges
      .filter((e) => !e.indoor && !e.sheltered)
      .reduce((sum, e) => sum + e.distanceM, 0),
    facilities: [...new Set(edges.map((e) => e.facilityId).filter((id): id is string => !!id))],
  };
}

/** Consume the same AgentResult contract used by the live API, without network or UI side effects. */
export function applyDemoResult(scene: Scene, state: DemoState, input: AgentResult): DemoState {
  const result = validateResult(input, scene);
  if (result.agent === 'preferences') {
    const p = result.payload;
    return {
      ...state,
      policy_mode: 'accessible',
      preferences: p,
      routing: applyRoutingPreferences(state.routing, p),
    };
  }
  if (result.agent === 'obstacle') {
    const event = obstacleEvent(result);
    return {
      ...state,
      routing: {
        ...state.routing,
        events: [...state.routing.events.filter((e) => e.id !== event.id), event],
      },
    };
  }
  if (result.agent === 'localization') {
    if (result.payload.status !== 'matched') throw new Error('例子需使用地圖定位結果');
    return { ...state, current_node_id: result.payload.map_db_node_id! };
  }
  return { ...state, guidance: result.payload.text };
}
