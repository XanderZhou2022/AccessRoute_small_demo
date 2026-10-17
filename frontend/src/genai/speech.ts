import type { SpeechPlan } from '../../../shared/genai/workflows';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { Capacitor } from '@capacitor/core';
import { apiUrl } from '../api/url';

async function speakWithAndroidGoogle(text: string, selection: SpeechPlan['selection']) {
  let supported = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    supported = (await TextToSpeech.isLanguageSupported({ lang: 'yue-HK' })).supported;
    if (supported) break;
    if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  if (!supported) {
    throw new Error(
      '手機沒有可用的 yue-HK 粵語聲線。請在 Android「文字轉語音輸出」選用 Google 語音服務並安裝香港粵語語音。',
    );
  }
  const { voices } = await TextToSpeech.getSupportedVoices();
  const preferredVoice =
    selection === 'cantonese_male'
      ? /(male|wanlung|男)/i
      : /(female|hiumaan|女)/i;
  const voice = voices.findIndex(
    (candidate) =>
      /^yue-HK$/i.test(candidate.lang) &&
      preferredVoice.test(`${candidate.name} ${candidate.voiceURI}`),
  );
  await TextToSpeech.stop();
  await TextToSpeech.speak({
    text,
    lang: 'yue-HK',
    rate: 0.9,
    pitch: 1,
    volume: 1,
    ...(voice >= 0 ? { voice } : {}),
  });
}

async function playBackendSpeech(text: string, selection: SpeechPlan['selection']): Promise<void> {
  const response = await fetch(apiUrl('/api/genai/speech'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, selection }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `伺服器語音服務失敗（HTTP ${response.status}）`);
  }
  const audioUrl = URL.createObjectURL(await response.blob());
  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(audioUrl);
    const cleanup = () => URL.revokeObjectURL(audioUrl);
    audio.addEventListener('ended', () => {
      cleanup();
      resolve();
    });
    audio.addEventListener('error', () => {
      cleanup();
      reject(new Error('伺服器粵語語音播放失敗'));
    });
    void audio.play().catch((error: unknown) => {
      cleanup();
      reject(error);
    });
  });
}

export function speak(text: string, plan: SpeechPlan): Promise<void> {
  if (plan.selection === 'text_only') return Promise.resolve();
  if (Capacitor.getPlatform() === 'android') return speakWithAndroidGoogle(text, plan.selection);
  if (plan.mode === 'azure' || plan.mode === 'canto_tts')
    return playBackendSpeech(text, plan.selection);
  if (!('speechSynthesis' in window)) return Promise.reject(new Error('此瀏覽器未提供語音播報'));
  const synth = window.speechSynthesis;
  return new Promise((resolve, reject) => {
    const cantoneseVoices = () =>
      synth.getVoices().filter((voice) => /^yue-HK$/i.test(voice.lang));
    const start = () => {
      const cantonese = cantoneseVoices();
      if (!cantonese.length) {
        reject(
          new Error(
            '找不到 yue-HK 香港粵語聲線，請在系統語音設定安裝「粵語（香港）」語音；不會改用英文朗讀。',
          ),
        );
        return;
      }
      const preferred =
        plan.selection === 'cantonese_male'
          ? /(?<!fe)male|wanlung|danny|男/i
          : /female|sinji|hiumaan|女/i;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = cantonese.find((v) => preferred.test(v.name)) || cantonese[0];
      utterance.lang = 'yue-HK';
      utterance.rate = 0.9;
      utterance.onend = () => resolve();
      utterance.onerror = (e) => {
        if (e.error === 'interrupted' || e.error === 'canceled') {
          resolve();
          return;
        }
        reject(new Error(`語音播放失敗：${e.error}`));
      };
      synth.cancel();
      synth.speak(utterance);
    };
    if (cantoneseVoices().length) start();
    else {
      let timer: number;
      const finish = () => {
        window.clearTimeout(timer);
        synth.removeEventListener('voiceschanged', loaded);
        start();
      };
      const loaded = () => {
        if (cantoneseVoices().length) finish();
      };
      timer = window.setTimeout(finish, 1500);
      synth.addEventListener('voiceschanged', loaded);
    }
  });
}
