import { observeLocation } from '../agents/vision';
import { retrieveAndMatch } from './matching';
import { decision } from '../retrieval/rank';
import { envelope, type WorkflowDependencies, type WorkflowRun } from './types';
import type { PhotoInput, MapCandidate } from '../../shared/genai/workflows';
export async function localizationWorkflow(
  deps: WorkflowDependencies,
  photo: PhotoInput,
): Promise<WorkflowRun> {
  const observation = await observeLocation(deps.model, photo.image);
  const candidates = await retrieveAndMatch(deps, observation, photo, 'landmark');
  const status = decision(candidates, 'localization');
  const build = (candidate: MapCandidate, score: number, confirmed: boolean) =>
    envelope(deps.map, 'localization', {
      is_indoor: !!candidate.level_id,
      status: 'matched',
      map_db_node_id: candidate.node_id,
      ...(candidate.level_id ? { level_id: candidate.level_id } : {}),
      anchor_names: candidate.names,
      direction_hint: observation.direction_hint,
      confidence: score,
      match_method: confirmed ? 'user_confirmed' : 'map_evidence',
      ...(photo.position ? { gps: photo.position } : {}),
    });
  const response = {
    workflow: 'localization' as const,
    status,
    result: status === 'ready' ? build(candidates[0], candidates[0].score, false) : null,
    candidates,
    trace: [
      {
        step: 'vision-agent',
        summary: `可讀名稱：${observation.names.join('、') || '無'}；可見特徵：${observation.objects.join('、') || '無'}`,
      },
      {
        step: 'map-retrieval',
        summary: `按位置、樓層及路線範圍檢索到 ${candidates.length} 個候選`,
      },
      { step: 'map-matching-agent', summary: '對比照片文字及物件特徵與地圖候選紀錄' },
      {
        step: 'ranking',
        summary: '文字 70% + 語意證據 15% + 距離 10% + 路線 5%；保留原始觀察置信度上限',
      },
    ],
    message:
      status === 'ready'
        ? '地標匹配明確，可將導航起點移至該地標附近。'
        : status === 'needs_confirmation'
          ? '找到可能的位置，請確認目前靠近哪個地標。'
          : '目前地圖沒有足夠的匹配資料，請補拍清楚的店名或樓層標誌。',
  };
  return {
    response,
    ...(status === 'needs_confirmation'
      ? { pending: { response, context_id: deps.map.input.context_id, build } }
      : {}),
  };
}
