# API findings — 2026-09-27

## Observed results

| Service                           | Observed result                                    | Saved evidence                          |
| --------------------------------- | -------------------------------------------------- | --------------------------------------- |
| Indoor building venue WFS         | 689 FeatureCollection entries, EPSG:4326           | data/raw/venues.json and venues.headers |
| MTR indoor venue WFS              | 98 entries                                         | data/raw/mtr-venues.json                |
| Six building candidates           | 24 successful feature responses                    | data/raw/{venue UUID}/*.json            |
| Two station candidates            | 6 successful feature responses                     | data/raw/{station UUID}/mtr_*.json      |
| retrieveTravelModes               | 5 advertised modes; Barrier Free Path ID read as 2 | data/raw/travel-modes.json              |
| Baseline indoor station route     | Success; 46.1876m, Z and directions returned       | data/raw/route-baseline.json            |
| Hysan chosen exterior link        | HTTP success with API error code 400, no solution  | data/raw/hysan-place-outdoor-route.json |
| PopCorn 2 chosen exterior link    | Successful route and Z geometry                    | data/raw/popcorn-2-outdoor-route.json   |
| MTR barrier-free and station CSVs | Three files downloaded and parsed                  | data/raw/*.csv                          |

`HTTP 200` alone is not a successful route: the Hysan JSON error is recorded as a failed route. The working baseline uses the documentation's station concourse/platform points but selects travelMode from the live retrieveTravelModes payload. It is separate feasibility evidence, not proof of either selected building's full accessibility.

## Fields and semantics

Indoor features carry stable `venue_id`, `building_id`, `level_id` and type-specific IDs. Levels carry ordinal, Z and display names. Unit categories expose walkway, lobby, elevator, stairs, escalator and restricted units. Amenities expose elevator / entry / accessible toilets, but many accessibility fields are null. All 689 building venue rows in this snapshot advertise `venue_network=False`; this is preserved and not interpreted as absence of indoor geometry.

Elevator amenities do not provide a verified shared shaft ID across floors. Demo pairing uses horizontal proximity under 1m and excludes features explicitly named service / fireman's / platform lift. Connections and accessibility remain unverified even when two features align perfectly.

The CORS probe sent `Origin: http://localhost:5173`. Saved WFS headers returned that value in `Access-Control-Allow-Origin` and allowed credentials. This confirms this origin's response headers, not all origins or future Pages behavior. Production demo requests only its own frozen files.

WFS documentation limits each response to 5000 entries. The largest sampled feature response is below that limit (PopCorn 1 units: 4113). The candidate downloader works sequentially with a pause between requests; all raw responses and hashes are retained.

## Optional services

3D Spatial Data / Cesium Tiles requires keys according to the task book; no key was supplied and no 3D Tiles request is claimed. Local GeoJSON extrusion is used instead. No GenAI, weather or crowd-production calls were made.

## Reproducibility

`scripts/bootstrap_data.py` → `fetch_data.py` → `download_scene.py` → `test_route_api.py` → `find_demo_venues.py` → `build_scene_graph.py` → `enrich_outdoor.py` → rebuild → `audit_data.py`.

Raw responses are cached by file path. Remove or move the relevant cached response only when intentionally making a new snapshot. `data/source-index.json` distinguishes request-log timestamps from local-file modification timestamps for the initial downloads.
