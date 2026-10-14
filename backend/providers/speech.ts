import type { Preferences } from '../../shared/genai/contracts';
import type { SpeechPlan } from '../../shared/genai/workflows';
// Speech transport is independent of the language-generation workflow.
// The browser speaks the returned text; another speech provider can return an audio URL.
export interface SpeechProvider {
  prepare(
    text: string,
    selection: Preferences['tts_selection'],
  ): Promise<{ speech: SpeechPlan; audio_url?: string }>;
}
export class BrowserSpeechProvider implements SpeechProvider {
  async prepare(_text: string, selection: Preferences['tts_selection']) {
    return { speech: { mode: 'browser' as const, language: 'zh-HK' as const, selection } };
  }
}
