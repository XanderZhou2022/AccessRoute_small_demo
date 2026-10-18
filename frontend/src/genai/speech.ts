import type { SpeechPlan } from '../../../shared/genai/workflows';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { Capacitor } from '@capacitor/core';
import { apiUrl } from '../api/url';
import { toSpokenText } from './spoken';

export function loadCantoneseVoices(
  synth: SpeechSynthesis,
  signal?: AbortSignal,
): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    let poll: ReturnType<typeof setInterval>;
    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(poll);
      synth.removeEventListener?.('voiceschanged', check);
      signal?.removeEventListener('abort', abort);
    };
    const finish = (voices: SpeechSynthesisVoice[]) => {
      cleanup();
      resolve(voices);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Speech request superseded', 'AbortError'));
    };
    const check = () => {
      if (signal?.aborted) return abort();
      try {
        const voices = synth
          .getVoices()
          .filter((voice) => /^(?:zh-HK|yue)(?:-|$)/i.test(voice.lang.replace(/_/g, '-')));
        if (voices.length) finish(voices);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    synth.addEventListener?.('voiceschanged', check);
    signal?.addEventListener('abort', abort, { once: true });
    timeout = setTimeout(() => finish([]), 5000);
    poll = setInterval(check, 100);
    check();
  });
}

let pendingVoiceLoad: AbortController | undefined;

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
    selection === 'cantonese_male' ? /(male|wanlung|男)/i : /(female|hiumaan|女)/i;
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

let speechToken = 0;
let activeAudio: { audio: HTMLAudioElement; finish: () => void } | undefined;
let pendingFetch: AbortController | undefined;

export function stopSpeech() {
  speechToken += 1;
  pendingFetch?.abort();
  pendingFetch = undefined;
  if (activeAudio) {
    activeAudio.audio.pause();
    activeAudio.finish();
    activeAudio = undefined;
  }
}

async function playBackendSpeech(
  text: string,
  selection: SpeechPlan['selection'],
  token: number,
): Promise<void> {
  const controller = new AbortController();
  pendingFetch = controller;
  let blob: Blob;
  try {
    const response = await fetch(apiUrl('/api/genai/speech'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, selection }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || `伺服器語音服務失敗（HTTP ${response.status}）`);
    }
    blob = await response.blob();
  } catch (error) {
    if (token !== speechToken) return;
    throw error;
  } finally {
    if (pendingFetch === controller) pendingFetch = undefined;
  }
  if (token !== speechToken) return;
  const audioUrl = URL.createObjectURL(blob);
  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(audioUrl);
    const cleanup = () => URL.revokeObjectURL(audioUrl);
    const finish = () => {
      cleanup();
      resolve();
    };
    activeAudio = { audio, finish };
    audio.addEventListener('ended', () => {
      if (activeAudio?.audio === audio) activeAudio = undefined;
      finish();
    });
    audio.addEventListener('error', () => {
      cleanup();
      if (activeAudio?.audio === audio) activeAudio = undefined;
      reject(new Error('伺服器粵語語音播放失敗'));
    });
    void audio.play().catch((error: unknown) => {
      cleanup();
      if (activeAudio?.audio === audio) activeAudio = undefined;
      if (token === speechToken) reject(error);
      else resolve();
    });
  });
}

export function speak(rawText: string, plan: SpeechPlan): Promise<void> {
  if (plan.selection === 'text_only') return Promise.resolve();
  const text = toSpokenText(rawText);
  stopSpeech();
  const token = speechToken;
  if (Capacitor.getPlatform() === 'android' && plan.mode === 'browser')
    return speakWithAndroidGoogle(text, plan.selection);
  if (plan.mode === 'azure' || plan.mode === 'canto_tts')
    return playBackendSpeech(text, plan.selection, token);
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined')
    return Promise.reject(new Error('此瀏覽器未提供語音播報'));
  const synth = window.speechSynthesis;
  pendingVoiceLoad?.abort();
  const controller = new AbortController();
  pendingVoiceLoad = controller;
  synth.cancel();
  return loadCantoneseVoices(synth, controller.signal)
    .then((cantonese) => {
      if (controller.signal.aborted) return;
      if (!cantonese.length)
        throw new Error('等候後瀏覽器仍未提供粵語語音；請檢查系統語音設定，或使用文字指引');
      return new Promise<void>((resolve, reject) => {
        const preferred =
          plan.selection === 'cantonese_male'
            ? /(?<!fe)male|wanlung|danny|男/i
            : /female|sinji|hiumaan|女/i;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = cantonese.find((voice) => preferred.test(voice.name)) || cantonese[0];
        utterance.lang = utterance.voice.lang;
        utterance.rate = 0.9;
        utterance.onend = () => resolve();
        utterance.onerror = (event) => {
          if (event.error === 'interrupted' || event.error === 'canceled') {
            resolve();
            return;
          }
          reject(new Error(`語音播放失敗：${event.error}`));
        };
        synth.speak(utterance);
      });
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) return;
      throw error;
    })
    .finally(() => {
      if (pendingVoiceLoad === controller) pendingVoiceLoad = undefined;
    });
}
