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
    { name: 'Cantonese female', lang: 'zh-HK' },
    { name: 'Cantonese male', lang: 'zh-HK' },
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
  expect(play.mock.calls[0][0].voice).toBe(voices[2]);
  expect(play.mock.calls[0][0].lang).toBe('zh-HK');
});
it('reports a missing Cantonese voice without speaking in another language', async () => {
  const play = vi.fn();
  vi.stubGlobal('window', {
    speechSynthesis: {
      getVoices: () => [{ name: 'English', lang: 'en-US' }],
      cancel: vi.fn(),
      speak: play,
    },
  });
  await expect(speak('請慢慢行', plan)).rejects.toThrow('粵語語音');
  expect(play).not.toHaveBeenCalled();
});
