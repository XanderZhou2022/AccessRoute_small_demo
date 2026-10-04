import type { Scene, DynamicEvent } from '../../shared/domain/schema';
import type { WorkflowContext, MapContext } from '../../shared/genai/workflows';
import { IntegrationError } from '../../shared/genai/contracts';
import { route } from '../../shared/routing/route';
import { segmentRoute } from '../../shared/journey/segment';
export function prepareMapContext(
  scene: Scene,
  input: WorkflowContext,
  events: DynamicEvent[],
): MapContext {
  if (['transit', 'complete'].includes(input.phase))
    throw new IntegrationError('INVALID_PHASE', '請於步行規劃或導航階段使用');
  if (
    scene.manifest.sceneId !== input.scene_id ||
    !scene.graph.nodes.some((n) => n.id === input.current_node_id) ||
    !scene.graph.nodes.some((n) => n.id === input.destination_node_id)
  ) {
    throw new IntegrationError('INVALID_REFERENCE', '目前位置或目的地不在此地圖');
  }
  const merged = new Map([...events, ...input.routing.events].map((e) => [e.id, e]));
  const routing = { ...input.routing, now: new Date().toISOString(), events: [...merged.values()] };
  const result = route(scene.graph, input.current_node_id, input.destination_node_id, routing);
  const segments = segmentRoute(scene.graph, result);
  const segment = segments[0] && input.segment_id ? { ...segments[0], id: input.segment_id } : null;
  return { input: { ...input, routing }, segments, segment };
}
