import catalog from './audio/catalog.json';

// Inline PCM recordings: no media URL, range request, or AAC decoder is needed
// after the presentation has loaded. Repeated narration shares the same clip.
const clips = import.meta.glob<string>('./audio/clips/*.wav', {
  eager: true,
  query: '?inline',
  import: 'default',
});

export function recordedAudioSource(caseId: string, stepId: string): string {
  const file = (catalog as Record<string, string>)[`${caseId}-${stepId}`];
  const source = clips[`./audio/clips/${file}`];
  if (!source) throw new Error('本段廣東話未包含在展示版本中');
  return source;
}

type Player = Pick<
  HTMLAudioElement,
  'error' | 'readyState' | 'ended' | 'currentTime' | 'load' | 'play'
>;
export async function playRecordedAudio(player: Player): Promise<void> {
  // play() alone cannot recover an HTMLMediaElement left in a failed state.
  if (player.error || player.readyState === 0) player.load();
  if (player.ended) player.currentTime = 0;
  await player.play();
}
