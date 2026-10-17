import { z } from 'zod';
import type { LocationResolutionRequest } from '../../shared/genai/workflows';
import type { ModelProvider } from '../providers/model';

const modelResponseSchema = z
  .object({
    status: z.enum(['ready', 'no_match']),
    origin_id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    destination_id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
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
  const currentOrigin = input.locations.find((location) => location.id === input.current_origin_id);
  const currentDestination = input.locations.find(
    (location) => location.id === input.current_destination_id,
  );
  const currentTrip =
    currentOrigin && currentDestination
      ? { origin: currentOrigin, destination: currentDestination }
      : null;
  const selected = modelResponseSchema.parse(
    await model.json({
      task: 'location-resolution',
      system: currentTrip
        ? `你是香港出行地點解析 agent。從語音轉文字中辨認使用者想前往的目的地及／或出發地，只可由 supplied_locations 的 id 中選擇，絕不能自行創造地點或 id。地點名稱可能是粵語口語、英文、音譯、簡稱或被語音辨識錯聽。

目前行程出發地是「${currentTrip.origin.name}」，目的地是「${currentTrip.destination.name}」。使用者只提到目的地時，保留目前出發地；只提到出發地時，保留目前目的地。明確說出兩地時，使用新兩地。若文字只描述輪椅、樓梯、路線偏好等出行需要而沒有提及地點，輸出 no_match，不要改動行程。

只有能可靠辨認出不同的出發地和目的地時才輸出：
{"status":"ready","origin_id":"最終出發地的 supplied id","destination_id":"最終目的地的 supplied id","message":"簡短繁體中文確認"}

如沒有地點意圖、無法可靠辨認地點，或兩地相同，輸出：
{"status":"no_match","message":"簡短繁體中文，指出保留目前行程或請使用者選擇地點"}

只輸出 JSON。`
        : `你是香港出行地點解析 agent。從語音轉文字中辨認出發地及目的地，只可由 supplied_locations 的 id 中選擇，絕不能自行創造地點或 id。地點名稱可能是粵語口語、英文、音譯、簡稱或被語音辨識錯聽。根據整句語意及 supplied_locations 決定最合理的兩個不同地點。

如能高信心選出不同的出發地及目的地，輸出：
{"status":"ready","origin_id":"supplied id","destination_id":"supplied id","message":"簡短繁體中文確認"}

如無法可靠判斷任一地點，輸出：
{"status":"no_match","message":"簡短繁體中文，請用選單選擇或重說"}

只輸出 JSON。`,
      input: {
        transcript: input.transcript,
        supplied_locations: input.locations,
        ...(currentTrip
          ? {
              current_trip: {
                origin_id: currentTrip.origin.id,
                destination_id: currentTrip.destination.id,
              },
            }
          : {}),
      },
    }),
  );
  if (selected.status === 'no_match') return selected;

  const ids = new Set(input.locations.map((location) => location.id));
  const originId = selected.origin_id ?? input.current_origin_id;
  const destinationId = selected.destination_id ?? input.current_destination_id;
  if (
    !originId ||
    !destinationId ||
    !ids.has(originId) ||
    !ids.has(destinationId) ||
    originId === destinationId
  ) {
    return {
      status: 'no_match',
      message: '未能可靠辨認兩個不同地點；請用選單選擇或再說一次。',
    };
  }
  return {
    status: 'ready',
    origin_id: originId,
    destination_id: destinationId,
    message: selected.message,
  };
}
