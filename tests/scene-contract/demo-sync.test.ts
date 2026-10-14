import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const pages = ['index.html', 'routes.html', 'navigation.html'];
const requiredHelpControls = [
  'data-report-form',
  'data-report-description',
  'data-localization-form',
  'data-localization-photo',
  'data-localization-description',
  'data-localization-consent',
  'data-localization-location',
  'data-localization-submit',
  'data-localization-results',
];

describe('map-demo help workflow parity', () => {
  it('keeps obstacle and photo-localization controls available on every page', async () => {
    const documents = await Promise.all(
      pages.map((page) =>
        readFile(new URL(`../../frontend/public/map-demo/${page}`, import.meta.url), 'utf8'),
      ),
    );
    for (const document of documents) {
      for (const control of requiredHelpControls) expect(document).toContain(control);
      expect(document).toContain('最多 6 MB');
      expect(document).not.toContain('迷路照片定位 agent 尚未接入');
    }
  });

  it('offers every supported mobility profile in the map-card journey', async () => {
    const [plan, preferences, operator, script, app, styles] = await Promise.all([
      readFile(new URL('../../frontend/public/map-demo/index.html', import.meta.url), 'utf8'),
      readFile(new URL('../../frontend/public/map-demo/preferences.html', import.meta.url), 'utf8'),
      readFile(new URL('../../frontend/public/map-demo/operator.html', import.meta.url), 'utf8'),
      readFile(new URL('../../frontend/public/map-demo/map-demo.js', import.meta.url), 'utf8'),
      readFile(new URL('../../frontend/src/App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../frontend/src/styles.css', import.meta.url), 'utf8'),
    ]);
    for (const profile of ['wheelchair', 'stroller', 'heavy_luggage', 'elderly', 'walking'])
      expect(plan).toContain(`data-profile="${profile}"`);
    for (const need of [
      'wheelchair',
      'stroller',
      'heavy',
      'elevator',
      'elderly',
      'stairs',
      'escalators',
      'avoid_lifts',
    ])
      expect(preferences).toContain(`value="${need}"`);
    expect(script).toContain('avoidLifts: String(avoidLifts)');
    expect(script).toContain("stroller: ['stroller', 'elevator']");
    expect(script).toContain("heavy_luggage: ['heavy', 'elevator']");
    expect(plan).toContain('data-weather-debug hidden');
    expect(script).toContain("get('debug') === '1'");
    expect(script).toContain('weatherDebugDetails.hidden = !debugMode');
    expect(operator).toContain('class="map-sheet operator-page"');
    expect(operator).toContain('data-operator-facility-status="active"');
    expect(operator).toContain('data-operator-command="advance"');
    expect(app).toContain("query.has('legacy')");
    expect(app).toContain('map-demo/index.html');
    expect(app).toContain('aria-label="地圖檢視"');
    expect(app).toContain('aria-label="選擇樓層"');
    expect(script).toContain('accessroute-map-view-change');
    expect(styles).toContain(".map-only-toolbar button[aria-pressed='true']");
  });
});
