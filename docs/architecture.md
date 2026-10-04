# Architecture and extension contracts

```
Official responses → acquisition adapters → Scene Package
                                           ↓
StaticSceneDataProvider / HttpSceneDataProvider
                                           ↓
Canonical MobilityGraph (immutable) + RoutingContext
                                           ↓
accessibilityPolicy + eventPolicy + weatherPolicy
                                           ↓
Dijkstra → RouteResult → segmentRoute → RouteSegment[]
                                           ↓
Journey UI → MacroMapRenderer / FloorMapRenderer
```

## Boundaries

`shared/domain` has no React, network or map dependencies. `shared/routing` depends only on canonical types and policy interfaces. No core function reads scene names, venue names or React state. Backend and frontend import exactly the same routing implementation. Renderers receive Scene and RouteSegment output; they cannot change routing availability.

`data/scenes/index.json` enumerates registered packages. Each contains manifest, graph, levels / units / openings / amenities / surroundings GeoJSON, and source-metadata. Stable venue, level and facility IDs prevent label-dependent logic.

Zod validates source values before any graph loads: finite nonnegative distances, ID uniqueness, connected edge endpoints, facility existence, scene consistency, vertical metadata, and safe manifest filenames. Scene-level checks verify entry points and referenced levels.

## Policies and events

Plugins expose `{ id, evaluate(edge, context) → { blocked?, penalty?, reasonCode? } }`. Duplicate plugin IDs and negative / nonfinite penalties are rejected. Any block removes the edge from effective adjacency; otherwise penalties add to distance. Rain adds nonnegative exposure cost. No negative “bonus” can invalidate Dijkstra.

Events have source, confidence, validity interval, status, and facility/edge targets. Facility closure and construction block; crowding adds a cost; custom types are ignored until a plugin defines semantics. Resolved, future and expired events do not affect the graph. Events never mutate or serialize over the base graph.

Runtime event expiry changes are checked in the UI and replanning starts at the current segment's start node. With simulated positioning, “current location” means that discrete segment anchor. Mid-edge continuous matching is explicitly not implemented.

## Journey and presentation

The demonstration constructs NavigationLeg A + abstract TransitLeg + NavigationLeg B. The domain models support a union of leg types. The UI maintains active leg and `currentSegmentIndex`. The segmenter groups indoor route edges by venue and level, isolates vertical transitions, and groups outdoor/bridge paths. Reversed paths reverse geometry and level direction.

Changing profile or event context preserves the current segment start and replaces remaining segments. Clicking “已到達” advances the discrete state; arriving at a transition's target level changes the displayed official floor. An unavailable route disables progression.

## Add a scene

1. Prepare a new directory under `data/scenes/<scene-id>/` using schema version 1.0 and valid referenced files.
2. Preserve coordinates in WGS84, explicit floor IDs, known / unknown accessibility and provenance; never synthesize `wheelchair=yes` from nulls.
3. Add its ID to `data/scenes/index.json`.
4. Run `npm run data:sync`, `npm test` and `npm run build`.
5. It appears in From / To options with no core, renderer or Journey component changes.

The third-scene contract test creates a structurally independent fixture, validates it and routes it through the same core. Provider swap tests compare segment output from static and mock HTTP adapters.

## Upgrade paths

A remote SceneDataProvider may replace static loading without changing graph types. A remote EventProvider can fetch authenticated official / crowd events later. A future TransitProvider can replace the abstract card. True positioning should update segment progress through its own adapter. Production persistence, authentication, weather and multimodal extraction remain separate integrations.

## 地圖與多 Agent 流程

新版將 HTTP API、外部模型供應商、單一角色 agent、地圖檢索和 workflow 組合分開。四套流程、候選確認與匹配分數見 [GenAI 架構](genai-architecture.md)，接口契約見 [接入手冊](genai-integration.md)。

## Twelve-location data expansion (2026-10-04)

`data/scenes/index.json` now registers twelve scenes. Eleven use official floor/unit geometry; Kowloon Tong uses the official 3D pedestrian network, with indoor centreline views explicitly distinguished from room polygons. Routing/domain contracts are unchanged. Acquisition preserves full building layers, bounded pedestrian graphs and POI candidates separately from compact demo graphs. See `location-expansion.md` and `data/location-catalog.json` for measured coverage and remaining hospital/landmark gaps.
