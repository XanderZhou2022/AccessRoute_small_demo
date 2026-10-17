import { expect, it } from 'vitest';
import { AzureSpeechProvider } from '../../backend/providers/speech';

it('synthesizes Cantonese audio with Azure Neural voices and caches repeated text', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  let calls = 0;
  const send: typeof fetch = async (input, init) => {
    calls += 1;
    requestUrl = String(input);
    requestInit = init;
    return new Response(Uint8Array.of(1, 2, 3), { status: 200 });
  };
  const provider = new AzureSpeechProvider({ key: 'test-key', region: 'eastasia' }, send);

  const first = await provider.synthesize('請慢行 & 小心 <樓梯>', 'cantonese_male');
  const second = await provider.synthesize('請慢行 & 小心 <樓梯>', 'cantonese_male');

  expect(requestUrl).toBe('https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1');
  expect(new Headers(requestInit?.headers).get('Ocp-Apim-Subscription-Key')).toBe('test-key');
  expect(new Headers(requestInit?.headers).get('X-Microsoft-OutputFormat')).toBe(
    'audio-24khz-48kbitrate-mono-mp3',
  );
  expect(requestInit?.body).toContain('zh-HK-WanLungNeural');
  expect(requestInit?.body).toContain('請慢行 &amp; 小心 &lt;樓梯&gt;');
  expect(first).toEqual(Uint8Array.of(1, 2, 3));
  expect(second).toEqual(first);
  expect(calls).toBe(1);
});

it('reports Azure quota failures without hiding the provider error', async () => {
  const send: typeof fetch = async () => new Response(null, { status: 429 });
  const provider = new AzureSpeechProvider({ key: 'test-key', region: 'eastasia' }, send);

  await expect(provider.synthesize('請慢行', 'cantonese_female')).rejects.toMatchObject({
    status: 503,
    code: 'SPEECH_QUOTA_EXCEEDED',
  });
});
