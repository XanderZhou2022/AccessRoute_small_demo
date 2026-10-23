# Data

`raw/` stores original official responses, `scenes/` contains normalized scene packages, and `runtime/` holds local demo events. Do not use runtime state to overwrite raw data or scene graphs.

## Reconstruction

All data required for the demo is frozen; no network access is needed by default. Requirements: Python 3.12 and Shapely 2.1.2 (see `scripts/requirements.txt`). Run these commands from the project root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
python3 scripts/find_demo_venues.py
.venv/bin/python scripts/build_scene_graph.py
npm run data:sync
```

To refresh data online, first back up or move the raw files you intend to update; downloaders preserve existing snapshots by default. Run `python3 scripts/bootstrap_data.py`, `python3 scripts/fetch_data.py`, `python3 scripts/download_scene.py`, and `python3 scripts/test_route_api.py`. After generating scenes, run `python3 scripts/enrich_outdoor.py` to save outdoor baselines at both ends, then rebuild the scenes. Requests run sequentially at a low frequency, preserving original responses and their URLs, hashes, and headers. Do not send large batches of concurrent requests to official services.

## Data semantics

- Coordinates: EPSG:4326, with longitude / latitude / optional Z. Local distance calculations use an approximate metric projection centered on the scene.
- Floors: official UUIDs serve as IDs; G/F and 1/F are labels only. Do not infer floor order by sorting strings.
- `provenance=derived`: grid nodes and horizontal connections generated from official public-corridor geometry. This does not establish verified accessibility.
- `provenance=manual/demo augmentation`: lift pairings between floors, outdoor handoffs, and station-entrance connections. Each edge records a `sourceRef`; the scene's `source-metadata.json` provides a summary.
- `wheelchair=unknown`: all edges in this version have unknown accessibility. Missing official values are not filled in as `yes`.
- Lift A / B are demo labels. Metadata records official amenity IDs for both floors, not official equipment identifiers.

The original JSON / GeoJSON files for the two scene packages use compact formatting to reduce size; schemas, source metadata, and manifests remain directly readable. Each build copies data from the project root to the frontend, keeping a single source of truth.

## Expansion on 2026-10-04

The scene registry now contains 12 scenes. Additional official 3D pedestrian-network data is in `pedestrian/`, and the POI index covering all floors is in `poi/`. See `location-catalog.json` for completeness and gaps. Do not treat the candidate POI index as verified visual landmarks. See `../docs/location-expansion.md` for details.
