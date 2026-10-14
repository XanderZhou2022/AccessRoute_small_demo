import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findMtrRoute } from '../../shared/journey/mtr';

const csv = readFileSync(
  new URL('../../data/raw/mtr_lines_and_stations.csv', import.meta.url),
  'utf8',
);
const sceneIds: string[] = JSON.parse(
  readFileSync(new URL('../../data/scenes/index.json', import.meta.url), 'utf8'),
).scenes;
const scenes = sceneIds.map((sceneId) => ({
  sceneId,
  ...JSON.parse(
    readFileSync(new URL(`../../data/scenes/${sceneId}/manifest.json`, import.meta.url), 'utf8'),
  ),
}));

describe('MTR station routing', () => {
  it('finds a directed station-by-station route across MTR lines', () => {
    const result = findMtrRoute(csv, 'Causeway Bay', 'Tai Po Market');
    expect(result).not.toBeNull();
    expect(result!.stations[0].name).toBe('Causeway Bay');
    expect(result!.stations.at(-1)?.name).toBe('Tai Po Market');
    expect(result!.hops.some((hop) => hop.lineCode === 'TRANSFER')).toBe(true);
  });

  it('connects every ordered pair in the twelve saved map scenes', () => {
    const failures = scenes.flatMap((from) =>
      scenes.flatMap((to) => {
        if (from.sceneId === to.sceneId) return [];
        const route = findMtrRoute(csv, from.station, to.station);
        return route ? [] : [`${from.sceneId} (${from.station}) → ${to.sceneId} (${to.station})`];
      }),
    );
    expect(failures).toEqual([]);
  });
});
