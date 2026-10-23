# Offline replayable demo scenario library

The library contains 48 fictional persona stories and 384 stages across the 12 confirmed scenes. Each scene covers four needs: manual wheelchair use, heavy luggage, elderly travelers, and strollers. Stories progress through travel needs, rain, covered-route preferences, outages, positioning, guidance, connections, and arrival. The Kowloon Tong outage stage reroutes through a gentle ramp. Assets include 14 real historical reference photos, 384 map-location views, and 48 fictional outage notices, plus 496 shop and facility knowledge entries.

## Contents

- `index.json`: story menu, asset index, and counts.
- `cases/*.json`: user utterances, map context, each agent's input/output, preset `WorkflowResponse`, resulting state, route snapshots, images, and knowledge references for each stage. The Ms. Chan version includes a branch where unclear sign text leads to candidate retrieval using a partial name, followed by confirmation.
- `overlays.json`: demo travel conditions kept separate from the original map, including stair shortcuts and covered detours. Each edge is marked `manual/demo augmentation` / `demo_assumption`; original scenes are not overwritten.
- `media.json`: author, source, license, capture date, and the verification status of the exact camera node.
- `media/`: local site-reference photos, route-coordinate views, and clearly labeled fictional outage notices.
- `audit.json`: scene coverage and route-change statistics.
- `../knowledge/*.json`: official POI names, floors, coordinates, sources, candidate public nodes on the same floor, and image references.

Site images are historical photos licensed for reuse. The existence of a shop or building does not verify the camera position: `camera_node_id=null`, and these images are not treated as exact node calibrations. Shop-to-public-node mappings are limited to nodes within 20 meters on the same floor and marked approximate. Positioning workflow scores are capped at 0.79 and require user confirmation. Unmapped POIs remain available for name-based retrieval.

The API and scenario library share the `WorkflowClient`, `WorkflowResponse`, and `AgentResult` contracts. `apiWorkflowClient` sends HTTP requests, while `ExampleWorkflowClient` returns the fixture for the selected stage. `applyDemoResult` validates the result before updating navigation state, and `demoRoute` calculates routes using the shared routing engine. These scenarios are not recordings of model inference; the UI explicitly labels results as returned by the example library.

Stories use the fixed time `2026-10-04T09:00:00Z`, with outages valid for two hours. Replay preserves this clock and can be restarted at any time. It does not write actual backend events.

## Build and replay

Run from the project root:

```sh
npm run demo:build
npm run build
npm run demo:preview
```

Open `http://127.0.0.1:8788/?demo=1`. This service serves only static data, with no model or backend workflows, and does not read `.env`. The regular service also supports `http://127.0.0.1:8787/?demo=1`.

Use `npm run demo:media` only when preparing new assets. It accesses Wikimedia Commons and downloads licensed images; routine replay does not download assets.
