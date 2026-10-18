import { afterEach, expect, it, vi } from 'vitest';

const nativeTts = vi.hoisted(() => ({
  isLanguageSupported: vi.fn(),
  getSupportedVoices: vi.fn(),
  stop: vi.fn(),
  speak: vi.fn(),
}));

vi.mock('@capacitor-community/text-to-speech', () => ({ TextToSpeech: nativeTts }));

import { Capacitor } from '@capacitor/core';
import { speak } from '../../frontend/src/genai/speech';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('uses Android native yue-HK speech when browser TTS is selected', async () => {
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
  nativeTts.isLanguageSupported.mockResolvedValue({ supported: true });
  nativeTts.getSupportedVoices.mockResolvedValue({
    voices: [{ lang: 'yue-HK', name: 'Cantonese female', voiceURI: 'yue-HK-female' }],
  });
  nativeTts.stop.mockResolvedValue(undefined);
  nativeTts.speak.mockResolvedValue(undefined);

  await speak('請慢慢行', {
    mode: 'browser',
    language: 'zh-HK',
    selection: 'cantonese_female',
  });

  expect(nativeTts.stop).toHaveBeenCalledOnce();
  expect(nativeTts.speak).toHaveBeenCalledWith({
    text: '請慢慢行',
    lang: 'yue-HK',
    rate: 0.9,
    pitch: 1,
    volume: 1,
    voice: 0,
  });
});

it('uses the configured self-hosted Cantonese TTS on Android', async () => {
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
  const fetchMock = vi.fn().mockResolvedValue(new Response(Uint8Array.of(82, 73, 70, 70)));
  const audioHandlers = new Map<string, () => void>();
  class FakeAudio {
    constructor(_url: string) {}
    addEventListener(type: string, listener: () => void) {
      audioHandlers.set(type, listener);
    }
    play() {
      audioHandlers.get('ended')?.();
      return Promise.resolve();
    }
  }
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Audio', FakeAudio);

  await speak('請慢慢行', {
    mode: 'canto_tts',
    language: 'zh-HK',
    selection: 'cantonese_female',
    voice_selection: 'single_default',
  });

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/genai/speech',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: '請慢慢行', selection: 'cantonese_female' }),
    }),
  );
  expect(nativeTts.speak).not.toHaveBeenCalled();
  expect(audioHandlers.has('ended')).toBe(true);
});

it('never switches to an English voice when Android lacks yue-HK', async () => {
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
  nativeTts.isLanguageSupported.mockResolvedValue({ supported: false });
  vi.stubGlobal('window', {
    setTimeout: (callback: () => void) => {
      callback();
      return 1;
    },
  });

  await expect(
    speak('請慢慢行', { mode: 'browser', language: 'zh-HK', selection: 'cantonese_female' }),
  ).rejects.toThrow('yue-HK 粵語聲線');
  expect(nativeTts.speak).not.toHaveBeenCalled();
});
