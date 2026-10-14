import { verbalizeGuidance } from '../agents/guidance';
import { retrieveNearby } from '../retrieval/map-index';
import { IntegrationError } from '../../shared/genai/contracts';
import { envelope, type WorkflowDependencies, type WorkflowRun } from './types';
export async function guidanceWorkflow(deps: WorkflowDependencies): Promise<WorkflowRun> {
  const segment = deps.map.segment;
  if (!segment) throw new IntegrationError('NO_ACTIVE_SEGMENT', '目前沒有可播報的路段');
  const levelName = (id?: string) => deps.scene.manifest.levels.find((l) => l.id === id)?.label;
  const nearby = retrieveNearby(
    deps.scene,
    deps.index,
    deps.map,
    { level_id: segment.levelId || segment.fromLevel },
    'landmark',
  );
  const facts = {
    scene: deps.scene.manifest.nameZh,
    segment_id: segment.id,
    action:
      segment.type === 'transition'
        ? { lift: '乘搭升降機', stairs: '走樓梯', ramp: '沿坡道行進', escalator: '乘搭扶手電梯' }[
            segment.mode!
          ]
        : '沿畫面路線前往下一個路段位置',
    distance_m: Math.round(segment.distanceM),
    floor: levelName(segment.levelId),
    from_floor: levelName(segment.fromLevel),
    to_floor: levelName(segment.toLevel),
    facility: deps.scene.graph.facilities.find((f) => f.id === segment.facilityId)?.label,
    nearby_landmarks: nearby
      .filter((c) => c.route_distance_m < 8)
      .slice(0, 3)
      .map((c) => c.names[0]),
  };
  const { text } = await verbalizeGuidance(deps.model, facts);
  const selection = deps.map.input.preferences?.tts_selection || 'cantonese_female';
  const speech = await deps.speech.prepare(text, selection);
  return {
    response: {
      workflow: 'guidance',
      status: 'ready',
      result: envelope(deps.map, 'guidance', {
        segment_id: segment.id,
        text,
        ...(speech.audio_url ? { audio_url: speech.audio_url } : {}),
      }),
      candidates: [],
      speech: speech.speech,
      trace: [
        { step: 'route-facts', summary: '从目前剩餘路線提取距離、樓層、設施和附近地標' },
        { step: 'guidance-agent', summary: '轉為粵語短句' },
        {
          step: 'speech-provider',
          summary: selection === 'text_only' ? '文字模式' : '交由瀏覽器粵語語音服務播報',
        },
      ],
      message: '已生成目前路段的導航指引。',
    },
  };
}
