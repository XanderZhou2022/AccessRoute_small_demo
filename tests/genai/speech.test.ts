import { afterEach, it, expect, vi } from 'vitest';
import { speak } from '../../frontend/src/genai/speech';
const plan = { mode: 'browser', language: 'zh-HK', selection: 'cantonese_male' } as const;
afterEach(() => vi.unstubAllGlobals());
it('text-only mode does not need or invoke a speech engine', async () => {
  await expect(speak('文字', { ...plan, selection: 'text_only' })).resolves.toBeUndefined();
});
it('selects the Cantonese male voice instead of an English or female voice', async () => {
  const play = vi.fn((utterance) => utterance.onend());
  const voices = [
    { name: 'English male', lang: 'en-US' },
    { name: 'Hong Kong Mandarin', lang: 'zh-HK' },
    { name: 'Sinji female', lang: 'yue-HK' },
    { name: 'Cantonese male', lang: 'yue-HK' },
  ];
  vi.stubGlobal('window', {
    speechSynthesis: { getVoices: () => voices, cancel: vi.fn(), speak: play },
  });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      constructor(public text: string) {}
    },
  );
  await speak('請慢慢行', plan);
  expect(play.mock.calls[0][0].voice).toBe(voices[3]);
  expect(play.mock.calls[0][0].lang).toBe('yue-HK');
});
it('reports a missing Cantonese voice without speaking in another language', async () => {
  const play = vi.fn();
  const synth = {
    getVoices: () => [
      { name: 'English', lang: 'en-US' },
      { name: 'Hong Kong Mandarin', lang: 'zh-HK' },
    ],
    cancel: vi.fn(),
    speak: play,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('window', {
    speechSynthesis: synth,
    setTimeout: vi.fn((callback: () => void) => {
      callback();
      return 1;
    }),
    clearTimeout: vi.fn(),
  });
  await expect(speak('請慢慢行', plan)).rejects.toThrow('yue-HK');
  expect(play).not.toHaveBeenCalled();
});
it('treats a canceled utterance as non-fatal', async () => {
  const synth = {
    getVoices: () => [{ name: 'Sinji', lang: 'yue-HK' }],
    cancel: vi.fn(),
    speak: vi.fn((utterance) => utterance.onerror({ error: 'interrupted' })),
  };
  vi.stubGlobal('window', { speechSynthesis: synth });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      constructor(public text: string) {}
    },
  );

  await expect(speak('請慢慢行', plan)).resolves.toBeUndefined();
});
it('uses the backend audio endpoint for Azure Speech', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(Uint8Array.of(1, 2, 3)));
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
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:test-audio'),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal('Audio', FakeAudio);

  await speak('請慢慢行', {
    mode: 'azure',
    language: 'zh-HK',
    selection: 'cantonese_male',
  });

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/genai/speech',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: '請慢慢行', selection: 'cantonese_male' }),
    }),
  );
  expect(audioHandlers.has('ended')).toBe(true);
});
it('uses the backend audio endpoint for self-hosted Cantonese TTS', async () => {
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
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:test-canto-audio'),
    revokeObjectURL: vi.fn(),
  });
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
  expect(audioHandlers.has('ended')).toBe(true);
});
