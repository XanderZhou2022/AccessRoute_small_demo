import { preferenceSchema } from '../../shared/genai/contracts';
import type { ModelProvider } from '../providers/model';
import type { WorkflowContext } from '../../shared/genai/workflows';
export async function parsePreferences(
  model: ModelProvider,
  text: string,
  context: WorkflowContext,
) {
  const parsed = preferenceSchema.parse(
    await model.json({
      task: 'preferences',
      system: `你是出行意圖解析 agent。將用戶描述轉成 JSON：
{"mobility_type":"walking|wheelchair|manual_wheelchair|elderly|stroller|heavy_luggage|other","avoid_stairs":true,"avoid_steep_slopes":true,"prefer_covered_shelter":false,"tts_selection":"cantonese_female|cantonese_male|text_only"}。
只有描述明確符合輪椅、嬰兒車、重行李、長者或一般步行時才使用相應類型；無法合理歸入這些類型時用 other，不要勉強套用快捷選項。拉重行李或載重手推車用 heavy_luggage。other 以一般步行作路線基礎，必須保留並套用用戶明確提出的避樓梯、坡度、有蓋、升降機、扶手電梯及路線目標等條件。
依用戶明確需求更新，未提及的欄位沿用 existing_preferences。若用戶明確表示「不坐輪椅／唔使輪椅／可以正常步行」，mobility_type 必須改為 walking，不能沿用 existing_preferences 的 wheelchair。沒有既有值時：mobility_type 用目前 profile，輪椅、嬰兒車、重行李預設避樓梯與避陡坡，walking/elderly 預設避樓梯為 false，優先有蓋為 false，語音為 cantonese_female。用戶說可走樓梯時 avoid_stairs 為 false；說不想搭升降機時仍按其步行能力解析，輸出可選欄位 avoid_lifts（避開升降機）、allow_escalators（能否使用扶梯）、route_objective（balanced|shortest|sheltered|indoor|least_effort|fastest）、max_slope（百分比轉小數，例如5%為0.05）、min_width_m（米）。只在用戶提及或 existing_preferences 存在時輸出可選欄位。偏好室內用 indoor，下雨少淋雨用 sheltered，要求最短用 shortest。只輸出 JSON。`,
      input: {
        description: text,
        profile: context.routing.profile,
        existing_preferences: context.preferences,
      },
    }),
  );
  if (/不坐輪椅|唔使輪椅|毋須輪椅|可以正常步行|可正常步行/.test(text)) {
    return { ...parsed, mobility_type: 'walking' as const };
  }
  return parsed;
}
