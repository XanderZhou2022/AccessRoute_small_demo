import { z } from 'zod';
import type { LocationResolutionRequest } from '../../shared/genai/workflows';
import type { ModelProvider } from '../providers/model';

const modelResponseSchema = z
  .object({
    status: z.enum(['ready', 'no_match']),
    origin_id: z.string().regex(/^[a-z0-9-]+$/).optional(),
    destination_id: z.string().regex(/^[a-z0-9-]+$/).optional(),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export type LocationResolutionResponse = {
  status: 'ready' | 'no_match';
  origin_id?: string;
  destination_id?: string;
  message: string;
};

export async function resolveLocations(
  model: ModelProvider,
  input: LocationResolutionRequest,
): Promise<LocationResolutionResponse> {
  const selected = modelResponseSchema.parse(
    await model.json({
      task: 'location-resolution',
      system: `你是香港出行地點解析 agent。從語音轉文字中辨認出發地及目的地，只可由 supplied_locations 的 id 中選擇，絕不能自行創造地點或 id。地點名稱可能是粵語口語、英文、音譯、簡稱或被語音辨識錯聽。根據整句語意及 supplied_locations 決定最合理的兩個不同地點。

如能高信心選出不同的出發地及目的地，輸出：
{"status":"ready","origin_id":"supplied id","destination_id":"supplied id","message":"簡短繁體中文確認"}

如無法可靠判斷任一地點，輸出：
{"status":"no_match","message":"簡短繁體中文，請用選單選擇或重說"}

只輸出 JSON。`,
      input: { transcript: input.transcript, supplied_locations: input.locations },
    }),
  );
  if (selected.status === 'no_match') return selected;

  const ids = new Set(input.locations.map((location) => location.id));
  if (
    !selected.origin_id ||
    !selected.destination_id ||
    !ids.has(selected.origin_id) ||
    !ids.has(selected.destination_id) ||
    selected.origin_id === selected.destination_id
  ) {
    return {
      status: 'no_match',
      message: '未能可靠辨認兩個不同地點；請用選單選擇或再說一次。',
    };
  }
  return selected;
}
