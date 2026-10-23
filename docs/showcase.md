# AccessRoute guided showcase

Public entry: https://xanderzhou2022.github.io/AccessRoute_small_demo/showcase/

The Pages homepage opens the showcase when built with `VITE_SHOWCASE_HOME=true`. The complete app remains at `map-demo/index.html`; the existing offline case library remains at `?demo=1`. Local development keeps the complete app as its default entry and exposes the showcase at `http://127.0.0.1:5173/showcase/`.

## Presentation walkthrough

Choose a wheelchair, stroller, or elderly journey. Each has eight chapters: baseline, personal needs, rain, outage, photo localization, Cantonese guidance, transfer, and arrival. Chapters can be selected directly; each starts from its recorded case state, so presenters can repeat a demonstration consistently.

1. Start with the wheelchair case and advance to personal needs to compare the route with the distance-only baseline.
2. In the rain chapter, switch between sunny and rainy presets to compare walking distance and exposed sections.
3. Open **故障改道**. The outage observation is preset and waits for confirmation. Confirm to disable the case's lift and recompute the route. Restore the facility to compare again.
4. Open **照片定位**. Compare the sample photo with the candidate marker, then confirm to move the start to the nearby public node and recompute the remaining route.
5. Play **播放本段廣東話**. The bundled recording works without an installed Cantonese browser voice. Playback requires a user click.
6. Show the transfer and arrival chapters, or choose another journey. **重新開始** resets the chapter, confirmations, and weather comparison.

The case JSON and all four scene packages are bundled into the presentation JavaScript. Changing chapters does not fetch separate JSON or GeoJSON files, so a temporary 503 on a scene-data URL cannot leave the rendered presentation stuck loading. Photos and prerecorded audio remain ordinary static assets.

Opening the source `frontend/showcase/index.html` directly as a local file redirects to the published showcase. Use the local Vite HTTP address above when developing changes.

The showcase uses fixture data rather than live model results, weather, lift reports, GPS, or arbitrary photo analysis. Route geometry is derived from the existing scene graph and explicit demo overlays; accessibility attributes are not field verified. Rail transfer is narrative context, not live rail routing. Photo and voice credits are available from the result details and `frontend/public/showcase/credits.txt`.

## Build and publish

```bash
npm ci
npm test
BASE_PATH=/AccessRoute_small_demo/ VITE_SHOWCASE_HOME=true npm run build
BASE_PATH=/AccessRoute_small_demo/ npm run check:showcase
```

Serve `frontend/dist` through any static web server under the same base path to preview. There is no API server requirement. The Vite multipage build emits both `index.html` and `showcase/index.html`; all scene JSON, photos, and 24 M4A recordings are copied into the build.

The GitHub Pages workflow runs tests, builds with the repository base path, audits showcase resources, and publishes `frontend/dist`. It runs on pushes to `main` and through manual workflow dispatch. The audit checks the showcase HTML asset paths, all three stories, scene files, referenced media, and 24 audio containers. Routing tests verify all eight chapters against the recorded case routes and exercise confirmation/reset behavior.
