import type { Preferences } from '../../shared/genai/contracts';
import type { SpeechPlan } from '../../shared/genai/workflows';
export interface SpeechProvider {
  readonly mode: SpeechPlan['mode'];
  readonly supportsVoiceSelection?: boolean;
  readonly audioContentType?: string;
  prepare(
    text: string,
    selection: Preferences['tts_selection'],
  ): Promise<{ speech: SpeechPlan; audio_url?: string }>;
  synthesize?(
    text: string,
    selection: Exclude<Preferences['tts_selection'], 'text_only'>,
  ): Promise<Uint8Array>;
}

export class BrowserSpeechProvider implements SpeechProvider {
  readonly mode = 'browser' as const;

  async prepare(_text: string, selection: Preferences['tts_selection']) {
    return { speech: { mode: this.mode, language: 'zh-HK' as const, selection } };
  }
}

export class AzureSpeechProvider implements SpeechProvider {
  readonly mode = 'azure' as const;
  readonly audioContentType = 'audio/mpeg';
  private readonly audioCache = new Map<string, Uint8Array>();

  constructor(
    private readonly config: { key: string; region: string },
    private readonly send: typeof fetch = fetch,
  ) {}

  async prepare(_text: string, selection: Preferences['tts_selection']) {
    return { speech: { mode: this.mode, language: 'zh-HK' as const, selection } };
  }

  async synthesize(text: string, selection: Exclude<Preferences['tts_selection'], 'text_only'>) {
    const voice = selection === 'cantonese_male' ? 'zh-HK-WanLungNeural' : 'zh-HK-HiuMaanNeural';
    const cacheKey = `${voice}\u0000${text}`;
    const cached = this.audioCache.get(cacheKey);
    if (cached) {
      this.audioCache.delete(cacheKey);
      this.audioCache.set(cacheKey, cached);
      return cached.slice();
    }
    const escapedText = text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
    let response: Response;
    try {
      response = await this.send(
        `https://${this.config.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/ssml+xml',
            'Ocp-Apim-Subscription-Key': this.config.key,
            'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
            'User-Agent': 'AccessRouteHK',
          },
          body: `<speak version="1.0" xml:lang="zh-HK"><voice name="${voice}">${escapedText}</voice></speak>`,
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      throw Object.assign(new Error('Azure Speech 連線失敗或請求逾時'), {
        status: 502,
        code: 'SPEECH_PROVIDER_UNAVAILABLE',
      });
    }
    if (!response.ok) {
      throw Object.assign(new Error(`Azure Speech API HTTP ${response.status}`), {
        status: response.status === 429 ? 503 : 502,
        code: response.status === 429 ? 'SPEECH_QUOTA_EXCEEDED' : 'SPEECH_API_ERROR',
      });
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    if (!audio.length) {
      throw Object.assign(new Error('Azure Speech 沒有回傳音訊'), {
        status: 502,
        code: 'SPEECH_EMPTY_AUDIO',
      });
    }
    this.audioCache.set(cacheKey, audio);
    if (this.audioCache.size > 50) this.audioCache.delete(this.audioCache.keys().next().value!);
    return audio.slice();
  }
}

export class SelfHostedCantoneseSpeechProvider implements SpeechProvider {
  readonly mode = 'canto_tts' as const;
  readonly supportsVoiceSelection = false;
  readonly audioContentType = 'audio/wav';
  private readonly audioCache = new Map<string, Uint8Array>();

  constructor(
    private readonly endpoint: string,
    private readonly send: typeof fetch = fetch,
  ) {}

  async prepare(_text: string, selection: Preferences['tts_selection']) {
    return {
      speech: {
        mode: this.mode,
        language: 'zh-HK' as const,
        selection,
        voice_selection: 'single_default' as const,
      },
    };
  }

  async synthesize(text: string, _selection: Exclude<Preferences['tts_selection'], 'text_only'>) {
    const cached = this.audioCache.get(text);
    if (cached) {
      this.audioCache.delete(text);
      this.audioCache.set(text, cached);
      return cached.slice();
    }

    let response: Response;
    try {
      response = await this.send(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw Object.assign(new Error('自架粵語語音服務連線失敗或請求逾時'), {
        status: 503,
        code: 'SPEECH_PROVIDER_UNAVAILABLE',
      });
    }
    if (!response.ok) {
      throw Object.assign(new Error(`自架粵語語音服務 HTTP ${response.status}`), {
        status: 502,
        code: 'SPEECH_PROVIDER_ERROR',
      });
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'audio/wav' && contentType !== 'audio/x-wav') {
      throw Object.assign(new Error('自架粵語語音服務回傳了非 WAV 音訊'), {
        status: 502,
        code: 'SPEECH_INVALID_AUDIO',
      });
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    if (!audio.length) {
      throw Object.assign(new Error('自架粵語語音服務沒有回傳音訊'), {
        status: 502,
        code: 'SPEECH_EMPTY_AUDIO',
      });
    }
    this.audioCache.set(text, audio);
    if (this.audioCache.size > 50) this.audioCache.delete(this.audioCache.keys().next().value!);
    return audio.slice();
  }
}

export function configuredSpeechProvider(): SpeechProvider {
  const cantoTtsUrl = process.env.CANTO_TTS_URL?.trim() || '';
  if (cantoTtsUrl) {
    let endpoint: URL;
    try {
      endpoint = new URL(cantoTtsUrl);
    } catch {
      throw new Error('CANTO_TTS_URL must be a valid URL');
    }
    const hostname = endpoint.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(hostname))
    )
      throw new Error('CANTO_TTS_URL must use HTTPS or an HTTP loopback address');
    return new SelfHostedCantoneseSpeechProvider(endpoint.toString());
  }

  const key = process.env.AZURE_SPEECH_KEY?.trim() || '';
  const region = process.env.AZURE_SPEECH_REGION?.trim().toLowerCase() || '';
  if (!key && !region)
    return new SelfHostedCantoneseSpeechProvider('http://127.0.0.1:8000/synthesize');
  if (!key || !region)
    throw new Error('AZURE_SPEECH_KEY and AZURE_SPEECH_REGION must both be configured');
  if (!/^[a-z0-9-]+$/.test(region))
    throw new Error('AZURE_SPEECH_REGION must be a valid Azure region identifier');
  return new AzureSpeechProvider({ key, region });
}
