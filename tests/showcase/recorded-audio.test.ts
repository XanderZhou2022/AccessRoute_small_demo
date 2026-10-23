import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import catalog from '../../frontend/src/showcase/audio/catalog.json';
import { playRecordedAudio, recordedAudioSource } from '../../frontend/src/showcase/recordedAudio';
import { showcaseCases, showcaseChapters } from '../../shared/demo/showcase';

describe('self-contained Cantonese recordings', () => {
  it('packages every chapter as an inline mono 16 kHz PCM recording', () => {
    for (const example of showcaseCases)
      for (const chapter of showcaseChapters) {
        const source = recordedAudioSource(example.id, chapter.id);
        expect(source).toMatch(/^data:audio\/wav;base64,/);
        const bytes = Buffer.from(source.split(',')[1], 'base64');
        expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
        expect(bytes.subarray(8, 12).toString()).toBe('WAVE');
        expect(bytes.readUInt16LE(20)).toBe(1); // PCM
        expect(bytes.readUInt16LE(22)).toBe(1); // mono
        expect(bytes.readUInt32LE(24)).toBe(16000);
        expect(bytes.readUInt16LE(34)).toBe(16);
        const file = (catalog as Record<string, string>)[`${example.id}-${chapter.id}`];
        expect(bytes.equals(readFileSync(`frontend/src/showcase/audio/clips/${file}`))).toBe(true);
      }
    expect(() => recordedAudioSource('unknown', 'start')).toThrow();
  });

  it('reloads a failed player before retrying and resets completed playback', async () => {
    const calls: string[] = [];
    const player = {
      error: { code: 4 } as MediaError,
      readyState: 0,
      ended: true,
      currentTime: 8,
      load: vi.fn(() => calls.push('load')),
      play: vi.fn(async () => {
        calls.push('play');
      }),
    };
    await playRecordedAudio(player);
    expect(calls).toEqual(['load', 'play']);
    expect(player.currentTime).toBe(0);
  });

  it('keeps ready recordings intact and propagates playback refusal', async () => {
    const player = {
      error: null,
      readyState: 4,
      ended: false,
      currentTime: 2,
      load: vi.fn(),
      play: vi.fn(async () => {
        throw new Error('NotAllowedError');
      }),
    };
    await expect(playRecordedAudio(player)).rejects.toThrow('NotAllowedError');
    expect(player.load).not.toHaveBeenCalled();
    expect(player.currentTime).toBe(2);
  });
});
