import { applyRoutingPreferences } from '../../shared/routing/preferences';
import { parsePreferences } from '../agents/preferences';
import { route } from '../../shared/routing/route';
import { envelope, type WorkflowDependencies, type WorkflowRun } from './types';
export async function preferencesWorkflow(
  deps: WorkflowDependencies,
  text: string,
): Promise<WorkflowRun> {
  const preferences = await parsePreferences(deps.model, text, deps.map.input);
  const input = deps.map.input;
  const routing = applyRoutingPreferences(input.routing, preferences);
  const preview = route(
    deps.scene.graph,
    input.current_node_id,
    input.destination_node_id,
    routing,
  );
  return {
    response: {
      workflow: 'preferences',
      status: 'ready',
      result: envelope(deps.map, 'preferences', preferences),
      candidates: [],
      trace: [
        { step: 'intent-agent', summary: '用戶描述轉為出行偏好' },
        { step: 'routing-policy', summary: `依地圖重新規劃：${preview.status}` },
      ],
      message:
        preview.status === 'ok'
          ? '已解析出行需求，可以套用並更新路線。'
          : '已解析出行需求；目前條件下沒有可行路線。',
    },
  };
}
