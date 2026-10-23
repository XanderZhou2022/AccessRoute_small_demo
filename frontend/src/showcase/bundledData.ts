// Keep presentation data in the JavaScript build. Once the page renders, switching
// chapters must not depend on another JSON request succeeding on the demo network.
const files = import.meta.glob<string>(
  [
    '../../../data/demo/cases/{popcorn-2-wang,hysan-place-lam,kowloon-tong-festival-walk-lee}.json',
    '../../../data/demo/{index,overlays}.json',
    '../../../data/scenes/{popcorn-2,hysan-place,kowloon-tong-festival-walk,shek-kip-mei-services}/{manifest,graph,source-metadata}.json',
    '../../../data/scenes/{popcorn-2,hysan-place,kowloon-tong-festival-walk,shek-kip-mei-services}/{levels,units,openings,amenities,surroundings}.geojson',
  ],
  { eager: true, query: '?raw', import: 'default' },
);

const bundled = new Map(
  Object.entries(files).map(([path, content]) => [path.slice(path.indexOf('data/')), content]),
);

export function readBundledShowcaseJson<T>(path: string): T {
  const content = bundled.get(path);
  if (content === undefined) throw new Error(`展示資料未包含在此版本：${path}`);
  // Parse on use so renderers cannot mutate the next replay's original data.
  return JSON.parse(content) as T;
}
