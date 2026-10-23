import type { Scene } from '../domain/schema';
import type { DemoCase, DemoState } from './types';
import { applyDemoResult } from './navigation';

export const showcaseCases = [
  {
    id: 'popcorn-2-wang',
    label: '輪椅出行',
    journey: 'PopCorn 2 → 又一城',
    description: '雨天、升降機故障與照片定位',
  },
  {
    id: 'hysan-place-lam',
    label: '推嬰兒車',
    journey: '希慎廣場 → PopCorn 2',
    description: '避開樓梯，優先選擇有蓋路線',
  },
  {
    id: 'kowloon-tong-festival-walk-lee',
    label: '長者出行',
    journey: '又一城 → 石硤尾邨服務設施大樓',
    description: '天橋、緩坡與逐段指引',
  },
] as const;

export const showcaseChapters = [
  { id: 'start', title: '認識這段旅程', short: '旅程', action: '套用出行需要' },
  { id: 'preferences', title: '把需要變成路線條件', short: '需求', action: '看看下雨時怎麼走' },
  { id: 'rain', title: '下雨了，優先走有蓋路段', short: '天氣', action: '演示途中設施故障' },
  { id: 'fault', title: '升降機停用，確認後改道', short: '故障', action: '繼續照片定位' },
  { id: 'localization', title: '用地標照片確認位置', short: '定位', action: '聽聽下一步指引' },
  { id: 'guidance', title: '用廣東話說清楚下一步', short: '語音', action: '前往目的地接駁段' },
  { id: 'transfer', title: '接駁到目的地的步行路線', short: '接駁', action: '完成最後一段旅程' },
  { id: 'arrival', title: '已到達公共走廊會合點', short: '到達', action: '再演示一次' },
] as const;

export const showcaseDescriptions: Record<string, string> = {
  start: '選一個出行需要，跟着八個步驟，看看路線如何因天氣、設施和位置改變。',
  preferences: '把出行需要轉成選路條件，觀察路線如何避開樓梯與陡坡。',
  rain: '晴天和雨天可以有不同走法。切換天氣，比較露天距離和路線。',
  fault: '先對照停用告示與設施，再確認改道。地圖會顯示替代設施與距離變化。',
  localization: '用照片中的店名和地標找位置。先查看地圖上的候選點，再確認更新起點。',
  guidance: '將目前路段說成簡短廣東話。點擊播放，即可聽到預錄的下一步指引。',
  transfer: '由目的地車站接續步行到建築物。鐵路段只作接駁敘事，不包含即時班次。',
  arrival: '剩餘距離歸零，完成這段旅程。可以重播故事，或切換另一個出行案例。',
};

export function needsShowcaseConfirmation(stepId: string) {
  return stepId === 'fault' || stepId === 'localization';
}

export function showcaseState(
  example: DemoCase,
  index: number,
  applied: DemoState | null,
): DemoState {
  const step = example.steps[index];
  if (!step) throw new Error('沒有這個展示階段');
  if (applied) return applied;
  return needsShowcaseConfirmation(step.id) && index > 0
    ? example.steps[index - 1].state
    : step.state;
}

export function confirmShowcaseStep(scene: Scene, example: DemoCase, index: number): DemoState {
  const step = example.steps[index];
  if (!step || !needsShowcaseConfirmation(step.id) || !step.response?.result || index < 1)
    throw new Error('這個展示階段不需要確認');
  return applyDemoResult(
    scene,
    structuredClone(example.steps[index - 1].state),
    step.response.result,
  );
}
