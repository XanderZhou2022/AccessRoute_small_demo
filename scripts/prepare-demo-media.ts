import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DemoMedia } from '../shared/demo/types';

const root = resolve('data/demo');
await mkdir(`${root}/media`, { recursive: true });
const subjects: [string, string, string?][] = [
  ['hysan-place', 'Hysan Place Apple Store'],
  ['popcorn-2', 'PopCorn 2'],
  ['kowloon-tong-festival-walk', 'Festival Walk interior'],
  ['shek-kip-mei-services', 'Shek Kip Mei Estate Ancillary Facilities Block'],
  ['cheung-sha-wan-government', 'Cheung Sha Wan Government Offices'],
  ['sha-tin-government', 'Sha Tin Government Offices'],
  ['north-point-government', 'North Point Government Offices'],
  ['pei-ho-market', 'Pei Ho Street Municipal Services Building'],
  ['java-road-market', 'Java Road Municipal Services Building'],
  ['kowloon-city-market', 'Kowloon City Municipal Services Building'],
  ['tai-po-market', 'Tai Po Hui Market'],
  ['kwai-hing-government', 'Kwai Hing Government Offices'],
  ['hysan-place', 'File:Hysan Place Apple Store 201405.jpg', 'hysan-place-apple-front'],
  ['popcorn-2', 'File:PopCorn 2 KFC 07-06-2023.jpg', 'popcorn-2-kfc-front'],
];
const strip = (value = '') => value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
let records: DemoMedia[] = [];
try {
  records = JSON.parse(await readFile(`${root}/media.json`, 'utf8'));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
for (const [sceneId, subject, mediaId] of subjects) {
  const assetId = mediaId || `${sceneId}-photo`;
  if (records.some((r) => r.id === assetId)) continue;
  const query = new URLSearchParams({
    action: 'query',
    format: 'json',
    ...(subject.startsWith('File:') ? { titles: subject } : {
      generator: 'search', gsrnamespace: '6', gsrsearch: `"${subject}" filetype:bitmap`, gsrlimit: '8',
    }),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1000',
  });
  try {
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${query}`, {
      headers: { 'User-Agent': 'AccessRouteDemo/0.1 (educational demo asset preparation)' },
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json()) as any;
    const pages = Object.values(body.query?.pages || {}) as any[];
    const page = pages
      .sort((a, b) => a.index - b.index)
      .find((p) => {
        const info = p.imageinfo?.[0];
        return (
          /\.(jpe?g|png)$/i.test(p.title) &&
          /CC BY|Public domain|CC0/i.test(info?.extmetadata?.LicenseShortName?.value || '')
        );
      });
    if (!page) {
      console.log(`${sceneId}: no licensed image found`);
      continue;
    }
    const info = page.imageinfo[0],
      metadata = info.extmetadata;
    const image = await fetch(info.thumburl || info.url, { signal: AbortSignal.timeout(30_000) });
    if (!image.ok || !image.headers.get('content-type')?.startsWith('image/'))
      throw new Error(`image HTTP ${image.status}`);
    const path = `media/${mediaId || `${sceneId}-reference`}.${/\.png$/i.test(page.title) ? 'png' : 'jpg'}`;
    await writeFile(`${root}/${path}`, Buffer.from(await image.arrayBuffer()));
    records.push({
      id: assetId,
      scene_id: sceneId,
      title: page.title.replace(/^File:/, ''),
      path,
      kind: 'historical_photo',
      source_url: info.descriptionurl,
      author: strip(metadata.Artist?.value),
      license: strip(metadata.LicenseShortName?.value),
      license_url: metadata.LicenseUrl?.value || '',
      captured_at: strip(metadata.DateTimeOriginal?.value),
      description: strip(metadata.ImageDescription?.value),
      camera_node_id: null,
    });
    await writeFile(`${root}/media.json`, JSON.stringify(records, null, 2) + '\n');
    console.log(`${sceneId}: ${page.title} (${records.at(-1)!.license})`);
  } catch (e) {
    console.log(`${sceneId}: ${(e as Error).message}`);
  }
}
