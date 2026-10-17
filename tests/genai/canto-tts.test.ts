import { afterEach, expect, it, vi } from 'vitest';
import {
  configuredSpeechProvider,
  SelfHostedCantoneseSpeechProvider,
} from '../../backend/providers/speech';

afterEach(() => vi.unstubAllEnvs());

it('caches the single self-hosted voice regardless of the selected gender preference', async () => {
  const wav = Uint8Array.of(82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69);
  let requestBody = '';
  let calls = 0;
  const send: typeof fetch = async (_input, init) => {
    calls += 1;
    requestBody = String(init?.body);
    return new Response(wav, { headers: { 'Content-Type': 'audio/wav' } });
  };
  const provider = new SelfHostedCantoneseSpeechProvider('http://127.0.0.1:8000/synthesize', send);

  const male = await provider.synthesize('請慢慢行', 'cantonese_male');
  const female = await provider.synthesize('請慢慢行', 'cantonese_female');

  expect(requestBody).toBe(JSON.stringify({ text: '請慢慢行' }));
  expect(male).toEqual(wav);
  expect(female).toEqual(wav);
  expect(calls).toBe(1);
  await expect(provider.prepare('請慢慢行', 'cantonese_male')).resolves.toMatchObject({
    speech: { mode: 'canto_tts', voice_selection: 'single_default' },
  });
});

it('rejects non-audio responses from the self-hosted service', async () => {
  const provider = new SelfHostedCantoneseSpeechProvider(
    'http://127.0.0.1:8000/synthesize',
    async () => new Response('not audio', { headers: { 'Content-Type': 'text/plain' } }),
  );

  await expect(provider.synthesize('請慢慢行', 'cantonese_female')).rejects.toMatchObject({
    status: 502,
    code: 'SPEECH_INVALID_AUDIO',
  });
});

it('uses the configured self-hosted service and rejects non-local insecure URLs', () => {
  vi.stubEnv('CANTO_TTS_URL', 'http://127.0.0.1:8000/synthesize');
  vi.stubEnv('AZURE_SPEECH_KEY', '');
  vi.stubEnv('AZURE_SPEECH_REGION', '');
  expect(configuredSpeechProvider().mode).toBe('canto_tts');

  vi.stubEnv('CANTO_TTS_URL', 'http://tts.example/synthesize');
  expect(() => configuredSpeechProvider()).toThrow('CANTO_TTS_URL must use HTTPS');
});
