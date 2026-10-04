import { createHash } from 'node:crypto';
import { observeObstacle } from '../agents/vision';
import { retrieveAndMatch } from './matching';
import { decision } from '../retrieval/rank';
import { envelope, type WorkflowDependencies, type WorkflowRun } from './types';
import type { PhotoInput, MapCandidate } from '../../shared/genai/workflows';
export async function obstacleWorkflow(
  deps: WorkflowDependencies,
  photo: PhotoInput,
): Promise<WorkflowRun> {
  const observation = await observeObstacle(deps.model, photo.image);
  const barrier = observation.barrier;
  // An ordinary lift photo is not evidence that a previously closed lift has reopened.
  if (!barrier.has_obstacle)
    return {
      response: {
        workflow: 'obstacle',
        status: 'no_match',
        result: null,
        candidates: [],
        trace: [{ step: 'vision-agent', summary: '照片未辨識到路障' }],
        message: '照片未辨識到路障，地圖事件保持目前狀態。',
      },
    };
  const ranked = await retrieveAndMatch(
    deps,
    observation,
    photo,
    barrier.type === 'broken_lift'
      ? 'lift'
      : barrier.type === 'facility_closed'
        ? 'facility'
        : 'path',
  );
  const candidates = ranked.map((c) => ({ ...c, score: Math.min(c.score, barrier.confidence) }));
  const status = decision(candidates, 'obstacle');
  const build = (candidate: MapCandidate, score: number, confirmed: boolean) => {
    const target = candidate.facility_id
      ? { facility_id: candidate.facility_id }
      : { edge_ids: candidate.edge_ids! };
    const targetId = createHash('sha256').update(JSON.stringify(target)).digest('hex').slice(0, 16);
    const now = Date.now();
    return envelope(deps.map, 'obstacle', {
      event_id: `photo-${targetId}`,
      has_obstacle: true,
      barrier_type: barrier.type,
      location_sign: [...observation.names, ...observation.text].join('、') || barrier.evidence,
      is_indoor: !!candidate.level_id,
      target,
      confidence: score,
      match_method: confirmed ? 'user_confirmed' : 'map_evidence',
      valid_from: new Date(now).toISOString(),
      valid_until: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
      ...(photo.position ? { gps: photo.position } : {}),
    });
  };
  const response = {
    workflow: 'obstacle' as const,
    status,
    result: status === 'ready' ? build(candidates[0], candidates[0].score, false) : null,
    candidates,
    trace: [
      { step: 'vision-agent', summary: `${barrier.type}：${barrier.evidence}` },
      {
        step: 'map-retrieval',
        summary: `取得 ${candidates.length} 個附近${barrier.type === 'broken_lift' ? '電梯' : barrier.type === 'facility_closed' ? '設施' : '路段'}候選`,
      },
      { step: 'map-matching-agent', summary: '將照片標誌及路障周邊線索對應至真實地圖 ID' },
      { step: 'event-proposal', summary: '生成兩小時有效的事件；套用結果後更新路線' },
    ],
    message:
      status === 'ready'
        ? '已將路障對應至地圖，可套用事件並改道。'
        : status === 'needs_confirmation'
          ? '已辨識路障，請確認它影響的具體設施或路段。'
          : '已辨識路障，但無法對應到目前地圖中的設施或路段。',
  };
  return {
    response,
    ...(status === 'needs_confirmation'
      ? { pending: { response, context_id: deps.map.input.context_id, build } }
      : {}),
  };
}
