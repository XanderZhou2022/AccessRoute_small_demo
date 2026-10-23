# AccessRoute HK

A research demo for accessible first- and last-mile navigation in Hong Kong, with a standalone frontend, a runnable backend, traceable official source data, and a pluggable routing core.

**Live demo: [Open AccessRoute HK](https://xanderzhou2022.github.io/AccessRoute_small_demo/)**

### Install on Android

AccessRoute can be installed from Android Chrome as a web app on your home screen. After deployment, open the demo link above in Chrome and choose **Install app** or **Add to Home screen** from the browser menu. Previously loaded static pages and data can be reopened offline; live weather, data that has not yet been loaded, and backend AI features still require a network connection or backend access. This navigation demo does not provide on-site indoor positioning. See the [frontend Android installation guide](frontend/README.md#android-installation).

A separate Android APK project is also available: [Android app guide](android-app/README.md). Core routing, maps, and scene data are bundled on the phone. Qwen AI, live Hong Kong Observatory weather, and paired journeys in the map demo require a public HTTPS backend. The current demo backend does not yet include the authentication and rate limiting required for a public service; follow the guide to deploy and secure it first.

## Updated product manuals (2026-10-14)

Both updated manuals include screenshots, a summary of changes from the previous version, and the current availability of each feature described in the old manual:

- [English PDF](docs/product-manual-v2.en.pdf) · [Traditional Chinese PDF](docs/product-manual-v2.zh-Hant.pdf)
- Editable web versions: [English](docs/product-manual-v2.en.html) · [Traditional Chinese](docs/product-manual-v2.zh-Hant.html)
- [Current feature status and follow-up acceptance plan (Traditional Chinese)](docs/acceptance.md)

On macOS, regenerate the PDFs with WebKit:

```bash
swiftc -parse-as-library scripts/export-product-manuals.swift -o /tmp/export-product-manuals && /tmp/export-product-manuals docs
```

## Data expansion to 12 locations (2026-10-04)

The project includes 12 selectable scenes and 132 ordered origin–destination pairs, covering the Festival Walk–Kowloon Tong Station footbridge, elderly service facilities, government offices, and markets. Eleven scenes have official unit floor plans; Festival Walk uses official road-network centerlines organized by level. Complete hospital indoor maps are still pending, with candidate data retained.

See the [12-location guide](docs/location-expansion.md) for site selection, data completeness, integration entry points, and reconstruction steps. The machine-readable catalog is `data/location-catalog.json`. The two-location example below remains available.

## Local setup and validation

For a non-technical Windows/macOS setup guide, see the [user manual](docs/user-manual.md).

Offline scenario entry point: **http://127.0.0.1:8787/?demo=1**. The demo library contains 48 persona stories, 384 stages, 496 wayfinding knowledge entries, and 14 licensed historical site-reference photos, covering travel needs, rain, outages, positioning, and arrival. The scenario library and technical demo labels are hidden from regular users unless `&debug=1` is added. `npm run demo:preview` serves a static demo on port 8788 without the model or workflow backend. See the [demo playbook](docs/demo-playbook.md) and [scenario library](data/demo/README.md) for assets, scenario assumptions, and walkthroughs.

If dependencies are already installed, run the following from the project root:

```bash
npm run dev
```

Open **http://127.0.0.1:5173/**. The default interface uses a map-card journey flow: location → travel settings → route → navigation/assistance. The frontend runs on port 5173 and the backend on port 8787, both bound to localhost. You can also open **http://127.0.0.1:5173/map-demo/index.html** directly. The original desktop planning workspace is available at **http://127.0.0.1:5173/?legacy=1**; the `?demo=1` offline story entry point and `?mapOnly=1` map-only mode remain available. On macOS, you can also double-click `啟動演示.command`. If the project is already using these ports, open the URL directly.

### Connect an Android phone to your computer

The phone does not need to install or run a server. Your computer can serve the app over a trusted private Wi-Fi network:

1. Connect the computer and phone to the same Wi-Fi network.
2. Run `npm run dev:lan` from the project directory on the computer and keep the terminal open.
3. Find the computer's private IPv4 address. On macOS, open System Settings → Wi-Fi → Details → TCP/IP. On Windows, run `ipconfig`.
4. In Android Chrome, open `http://<computer-IPv4>:5173/map-demo/index.html`, for example `http://192.168.1.23:5173/map-demo/index.html`. Remove `/map-demo/index.html` to open the main interface.

If the connection fails, allow Node.js/TCP port 5173 through the computer's firewall, confirm that both devices are on the same non-guest Wi-Fi network, and check that client isolation is disabled on the router. Press Ctrl+C when finished. This LAN development URL uses HTTP, so browser features requiring a secure HTTPS context, such as PWA offline installation and GPS positioning, are unavailable. Use the deployed HTTPS URL to install the PWA. Use LAN development mode only on a trusted private network, and do not configure public port forwarding on the router.

On a new computer, install Node.js 22.12+ (Node 22 LTS recommended), then run:

```bash
npm ci
npm run dev
```

To build and serve the complete app locally:

```bash
npm run build
npm start
```

The frontend and API are then both available at **http://127.0.0.1:8787/**. The static frontend also works without a backend. Selecting **Local backend API** uses the scene API and persists demo lift events.

## Suggested validation walkthrough

1. Keep the **Wheelchair** profile selected and inspect the journey: Hysan Place → Causeway Bay Station → illustrative public transport segment → Tseung Kwan O Station → PopCorn 2.
2. Click **Start navigation demo** to view the official 1/F floor plan, then click **Arrived** to advance to Lift A.
3. Before taking the lift, click **Simulate outage** for Lift A. The route is recalculated from the start of the current segment and switches to Lift B.
4. Disable Lift B as well and confirm that the route switches to the **Demo gentle ramp**. Only after all available connections between floors are disabled should the app report no feasible route.
5. Restore both lifts, reset the journey, and follow the prompts through G/F, the transport connection, and PopCorn 2 G/F → 1/F until **Journey demo completed** appears.
6. Enable **Use verified paths only**. Because accessibility attributes are unknown, the app should report no feasible route rather than allow passage without verification.
7. Try the elderly, stroller, and rainy-weather profiles, swap the origin and destination, and inspect different floors.
8. Switch to **Local backend API**, disable a lift, and refresh the page. The event should persist. Click **Restore service** to clear the demo impact. In static mode, events are stored only in the current page's memory.
9. Open **Data and notes**. See `docs/acceptance.md` for the full test report and limitations.

## Project structure

```text
frontend/              React + Vite + TypeScript UI, floor SVGs, MapLibre maps
backend/               Express API, event persistence, local production static server
shared/                React-independent domain / routing / journey / providers
  domain/              Zod schemas, canonical types, scene validation
  routing/             Pure Dijkstra routing, policy plugins, immutable event overlays
  journey/             Route segmentation into floor / transition / outdoor / bridge legs
  providers/           Shared scene contract for static and HTTP providers
data/
  raw/                 Official source data, request URLs, SHA-256 hashes (headers kept locally)
  scenes/              12 scene packages serving as the canonical normalized data source
  candidates.json/csv  Quantitative comparison of candidate scenes
  runtime/             Local backend events (created at runtime, excluded from version control)
scripts/               Data download, candidate scanning, graph generation, startup, static data sync
tests/                 Routing, policies, events, scene contracts, backend API tests
docs/                  Architecture, API discovery, site selection, visualization choices, validation
.github/workflows/     Tests and manual GitHub Pages deployment
```

`frontend/public/data/` is a build copy of `data/scenes/`; do not edit it manually. `npm run dev` and `npm run build` synchronize it automatically. The project specification PDF is not included in the repository.

## GenAI navigation assistant

The interface integrates four independent workflows: travel intent, photo-based obstacle reporting, photo-based positioning, and Cantonese guidance. For positioning and obstacle reporting, a vision-language model observes the photo, retrieves map information near the current position and route, and passes the evidence to a map-matching agent. Ambiguous matches are presented as candidates for confirmation, with the original matching scores retained.

- Set `DASHSCOPE_API_KEY` in the root `.env` file and run `npm run dev`. The backend loads the configuration automatically.
- See [architecture and matching algorithms](docs/genai-architecture.md) and the [HTTP integration guide](docs/genai-integration.md).
- `backend/api/` contains HTTP routes, `backend/providers/` model and speech interfaces, `backend/agents/` individual agent roles, `backend/workflows/` workflow composition, and `backend/retrieval/` map retrieval.
- Add verified shop names and appearance information to `data/landmarks/`. The system does not invent shops when official data is insufficient.
- The Android APK uses native device speech with the `yue-HK` locale. Google Speech Services with the Hong Kong Cantonese voice data installed is recommended in Android settings. The web app supports `yue-HK` browser speech, Azure Speech, or a self-hosted `canto-tts` Hong Kong Cantonese service running on a computer. The self-hosted model provides one default voice. See [self-hosted speech setup](docs/genai-integration.md#自架香港粵語-tts) and [Android speech and APK setup](android-app/README.md). The Python programs now act as HTTP clients of the same backend.
- The original JSON integration panel, version 1.0 result contract, and `/api/genai/validate` remain compatible.

## Implemented features

- Twelve scene packages: eleven official floor-plan scenes and one official road-network scene organized by level. The map demo calculates local first- and last-mile routes between two independently selected locations and generates inter-station directions from stored MTR station sequences. MTR journey times, schedules, fares, and accessibility facilities are not verified in real time.
- A Hysan Place graph with 512 nodes and 1,523 edges, and a PopCorn 2 graph with 2,081 nodes and 6,308 edges.
- Lift outage simulation, floor switching, recalculation of the remaining route, and `no_route` results for each scene.
- Wheelchair, elderly, and stroller policies; route preferences for outdoor exposure, indoor travel, distance, effort, and time; and a strict accessibility-attribute mode.
- Local GeoJSON building extrusions in 3D, with an automatic fallback to an SVG overview map if WebGL fails. Maps, fonts, and data do not depend on third-party CDNs.
- Backend health, scene, routing, and event APIs. Events are applied according to their source and validity period without changing the original graph.
- Static builds usable offline, mobile layouts, readable data notes, and official map attribution.

## Known limitations

**This is a demo, not a certified accessibility navigation service for on-site use.** The `wheelchair` attribute on every graph edge is explicitly set to `unknown`. Official geometry does not establish verified door widths, slopes, public access rights, or lift availability.

- Indoor connections in the eleven floor-plan scenes are derived from official corridor, lobby, and lift geometry using a 1.6 m grid and a 0.25 m geometric tolerance. Lift pairings between floors and short-distance snapping connections are explicitly marked as demo additions. Festival Walk uses the official 3D road network; outdoor connections for the nine additional buildings use the official road network. See the [expansion guide](docs/location-expansion.md).
- Building endpoints are demo points in public corridors. If the selected connected component has no attachable official entrance point, the G/F handoff point is also marked as requiring verification; building entrances are not claimed to be verified.
- The PopCorn 2 outdoor route uses saved official Barrier Free Path geometry as its baseline, with snapped connections at both ends still requiring verification. The official request between Hysan Place and the selected station entrance returned no solution, and the failure evidence is retained. That connection remains an explicitly labeled demo addition.
- Maps include only downloaded official building footprints, rather than a complete street basemap or photorealistic 3D Tiles.
- Photo-based positioning estimates a coarse location near a landmark and has not undergone on-site accuracy evaluation. Continuous real-time positioning, live official lift status, crowdsourcing, user accounts, and a complete public transport transfer algorithm are not available. Live weather requires backend connectivity, as described in the Android setup above.
- Backend event writes are intended for a local demo. Add production authentication before exposing the backend publicly. GitHub Pages deploys only the static frontend.

## Testing and development

```bash
npm test              # Routing / policies / events / scene contracts / API
npm run build         # Type checking, data synchronization, production frontend build
npm run check         # Tests + build
npm run format        # Format source code without modifying raw data
```

The source data is frozen, so validation does not require downloading it again. See `data/README.md` for data reconstruction, `backend/README.md` for API contracts, and `docs/architecture.md` for adding scenes.

## Deployment

Repository: [XanderZhou2022/AccessRoute_small_demo](https://github.com/XanderZhou2022/AccessRoute_small_demo).

GitHub Pages is published with GitHub Actions configured as its source. For subsequent updates, push the code and manually run **Deploy static demo to GitHub Pages** in Actions. The workflow runs tests, builds the app, and publishes only `frontend/dist/`. Pushing source code alone does not automatically update the website. Pages uses static data; the Express backend must run separately.

See [docs/upload.md](docs/upload.md) for commit scope and upload steps.

See [DATA_SOURCES.md](DATA_SOURCES.md) for data sources and attribution.
