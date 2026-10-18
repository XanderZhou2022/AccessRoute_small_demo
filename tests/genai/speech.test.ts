import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadCantoneseVoices, speak } from '../../frontend/src/genai/speech';
import { toSpokenText } from '../../frontend/src/genai/spoken';
const plan = { mode: 'browser', language: 'zh-HK', selection: 'cantonese_male' } as const;
const mapSource = readFileSync('frontend/public/map-demo/map-demo.js', 'utf8');
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.unstubAllGlobals());
afterEach(() => vi.useRealTimers());

it('waits for Cantonese voices after the browser initially returns an empty list', async () => {
  let voices: SpeechSynthesisVoice[] = [];
  let changed: (() => void) | undefined;
  const removeEventListener = vi.fn();
  const synth = {
    getVoices: () => voices,
    addEventListener: vi.fn((_event: string, listener: () => void) => {
      changed = listener;
    }),
    removeEventListener,
  } as unknown as SpeechSynthesis;

  const pending = loadCantoneseVoices(synth);
  await vi.advanceTimersByTimeAsync(300);
  voices = [{ name: 'Cantonese female', lang: 'yue-HK' } as SpeechSynthesisVoice];
  changed?.();

  await expect(pending).resolves.toEqual(voices);
  expect(removeEventListener).toHaveBeenCalledWith('voiceschanged', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

it('continues waiting through English-only voice updates and polls as a fallback', async () => {
  let voices = [{ name: 'English', lang: 'en-US' } as SpeechSynthesisVoice];
  const synth = {
    getVoices: () => voices,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as SpeechSynthesis;
  let settled = false;
  const pending = loadCantoneseVoices(synth).then((result) => {
    settled = true;
    return result;
  });

  await vi.advanceTimersByTimeAsync(1800);
  expect(settled).toBe(false);
  voices = [{ name: 'Cantonese male', lang: 'zh-HK' } as SpeechSynthesisVoice];
  await vi.advanceTimersByTimeAsync(100);

  await expect(pending).resolves.toEqual(voices);
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds the wait and aborts superseded voice loads', async () => {
  const synth = {
    getVoices: () => [{ name: 'English', lang: 'en-US' } as SpeechSynthesisVoice],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as SpeechSynthesis;
  const controller = new AbortController();
  const superseded = loadCantoneseVoices(synth, controller.signal);
  const rejected = expect(superseded).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  expect(vi.getTimerCount()).toBe(0);

  const unavailable = loadCantoneseVoices(synth);
  await vi.advanceTimersByTimeAsync(5000);
  await expect(unavailable).resolves.toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it('speaks the latest legacy request after delayed Cantonese voice loading', async () => {
  let voices: SpeechSynthesisVoice[] = [];
  const listeners = new Set<() => void>();
  const synth = {
    getVoices: () => voices,
    cancel: vi.fn(),
    speak: vi.fn((utterance) => utterance.onend()),
    addEventListener: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_event: string, listener: () => void) =>
      listeners.delete(listener),
    ),
  };
  vi.stubGlobal('window', { speechSynthesis: synth });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      constructor(public text: string) {}
    },
  );

  const first = speak('舊步驟', plan);
  const second = speak('新步驟', plan);
  voices = [{ name: 'Cantonese male', lang: 'yue-HK' } as SpeechSynthesisVoice];
  listeners.forEach((listener) => listener());
  await Promise.all([first, second]);

  expect(synth.speak.mock.calls.map(([utterance]) => utterance.text)).toEqual(['新步驟']);
  expect(vi.getTimerCount()).toBe(0);
});

it('map demo waits for the Cantonese voice before speaking on the first request', async () => {
  let voices: SpeechSynthesisVoice[] = [];
  const listeners = new Set<() => void>();
  const synth = {
    getVoices: () => voices,
    cancel: vi.fn(),
    speak: vi.fn((utterance) => {
      utterance.onstart?.();
      utterance.onend?.();
    }),
    addEventListener: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_event: string, listener: () => void) =>
      listeners.delete(listener),
    ),
  };
  const narrationStatus = { textContent: '' };
  const loaderSource = mapSource.slice(
    mapSource.indexOf('function loadCantoneseVoices('),
    mapSource.indexOf('function initializeNavigation()'),
  );
  const navigationSource = mapSource.slice(
    mapSource.indexOf(
      '  let pendingVoiceLoad;',
      mapSource.indexOf('function initializeNavigation()'),
    ),
    mapSource.indexOf(
      '  const workflowContext =',
      mapSource.indexOf('function initializeNavigation()'),
    ),
  );
  class Utterance {
    onstart?: () => void;
    onend?: () => void;
    onerror?: (event: { error: string }) => void;
    voice?: SpeechSynthesisVoice;
    lang = '';
    constructor(public text: string) {}
  }
  const speakInstruction = vm.runInNewContext(
    `${loaderSource}\n${navigationSource}\nspeakInstruction;`,
    {
      AbortController,
      DOMException,
      clearInterval,
      clearTimeout,
      setInterval,
      setTimeout,
      SpeechSynthesisUtterance: Utterance,
      apiFetch: async () => ({ ok: true, json: async () => ({ speech: 'browser' }) }),
      document: { querySelector: () => null },
      narrationStatus,
      window: {
        addEventListener: vi.fn(),
        SpeechSynthesisUtterance: Utterance,
        speechSynthesis: synth,
      },
    },
  ) as (instruction: { title: string; detail: string }, text?: string) => Promise<void>;

  const pending = speakInstruction(
    { title: '沿通道前行', detail: '前往升降機' },
    '沿通道行，去升降機。',
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(narrationStatus.textContent).toBe('正在載入粵語聲音…');
  voices = [{ name: 'Cantonese female', lang: 'zh-HK' } as SpeechSynthesisVoice];
  listeners.forEach((listener) => listener());
  await pending;

  expect(synth.speak).toHaveBeenCalledTimes(1);
  expect(narrationStatus.textContent).toBe('粵語朗讀完成。');
  expect(vi.getTimerCount()).toBe(0);
});

it('text-only mode does not need or invoke a speech engine', async () => {
  await expect(speak('文字', { ...plan, selection: 'text_only' })).resolves.toBeUndefined();
});
it('selects the Cantonese male voice instead of an English or female voice', async () => {
  const play = vi.fn((utterance) => utterance.onend());
  const voices = [
    { name: 'English male', lang: 'en-US' },
    { name: 'Mandarin', lang: 'zh-CN' },
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
      { name: 'Mandarin', lang: 'zh-CN' },
    ],
    cancel: vi.fn(),
    speak: play,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('window', { speechSynthesis: synth });
  vi.stubGlobal('SpeechSynthesisUtterance', class {});
  const pending = expect(speak('請慢慢行', plan)).rejects.toThrow('等候後瀏覽器仍未提供粵語語音');
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
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

it('rewrites transit steps into spoken Cantonese for narration', () => {
  const source = readFileSync('frontend/public/map-demo/map-demo.js', 'utf8');
  const start = source.indexOf('function toSpokenCantonese(');
  const toSpoken = vm.runInNewContext(
    `${source.slice(start, source.indexOf('function initializeNavigation()'))}\ntoSpokenCantonese;`,
  ) as (title: string, detail: string) => string;

  expect(toSpoken('乘搭荃灣綫，往中環方向', '由旺角站上車，經2個中途站於金鐘站下車。')).toBe(
    '搭荃灣綫，去中環方向。喺旺角站上車，中途經過2個站，喺金鐘站落車。',
  );
  expect(toSpoken('乘搭東鐵綫', '由九龍塘站上車，下一站於旺角東站下車。')).toBe(
    '搭東鐵綫。喺九龍塘站上車，下一個站喺旺角東站落車。',
  );
  expect(toSpoken('在金鐘站轉乘港島綫', '跟隨「港島綫・往柴灣」指示前往月台。')).toBe(
    '喺金鐘站轉車搭港島綫。跟住「港島綫・往柴灣」嘅指示去月台。',
  );
});

it('converts written floor labels and numbers into spoken Cantonese in both speakers', () => {
  const start = mapSource.indexOf('const SPOKEN_DIGITS');
  const mapSpoken = vm.runInNewContext(
    `${mapSource.slice(start, mapSource.indexOf('// Transit steps are written'))}\ntoSpokenText;`,
  ) as (text: string) => string;
  const cases: Array<[string, string]> = [
    ['喺1/F沿路行56米去下一段', '喺一樓沿路行五十六米去下一段'],
    ['由G/F搭電梯去2/F', '由地下搭電梯去二樓'],
    ['去UG/F同LG1', '去上地下同低層一樓'],
    ['落B2，再行110米', '落地庫二層，再行一百一十米'],
    ['行1.5米', '行一點五米'],
    ['由A1出口出閘', '由A1出口出閘'],
    ['行105米，12米', '行一百零五米，十二米'],
  ];
  for (const [input, expected] of cases) {
    expect(toSpokenText(input)).toBe(expected);
    expect(mapSpoken(input)).toBe(expected);
  }
});

it('speaks floor labels as Cantonese words', async () => {
  const play = vi.fn((utterance) => utterance.onend());
  vi.stubGlobal('window', {
    speechSynthesis: {
      getVoices: () => [{ name: 'Sinji', lang: 'yue-HK' }],
      cancel: vi.fn(),
      speak: play,
    },
  });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      constructor(public text: string) {}
    },
  );
  await speak('喺1/F行56米', plan);
  expect(play.mock.calls[0][0].text).toBe('喺一樓行五十六米');
});

it('stops the previous backend audio when the next speech starts', async () => {
  const clips: FakeAudio[] = [];
  class FakeAudio {
    paused = false;
    onended?: () => void;
    constructor(_url: string) {
      clips.push(this);
    }
    addEventListener(type: string, listener: () => void) {
      if (type === 'ended') this.onended = listener;
    }
    pause() {
      this.paused = true;
    }
    play() {
      return Promise.resolve();
    }
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(Uint8Array.of(82, 73, 70, 70)))),
  );
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  vi.stubGlobal('Audio', FakeAudio);
  const canto = { mode: 'canto_tts', language: 'zh-HK', selection: 'cantonese_male' } as const;

  const first = speak('第一句', canto);
  await vi.waitFor(() => expect(clips).toHaveLength(1));
  const second = speak('第二句', canto);
  await first;
  expect(clips[0].paused).toBe(true);
  await vi.waitFor(() => expect(clips).toHaveLength(2));
  expect(clips[1].paused).toBe(false);
  clips[1].onended?.();
  await second;
});
