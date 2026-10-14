# Data sources and attribution

Snapshot downloaded on 27 September 2026, Hong Kong time (26 September UTC). Every normalized scene includes `source-metadata.json`; raw JSON / CSV hashes and source URLs are in `data/source-index.json`. The acquisition script records successful and unsuccessful API payloads without rewriting them.

## Lands Department, HKSARG

- [3D Indoor Building Map API](https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-indoor-map-api)
- [3D Indoor MTR Station Map API](https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-indoor-mtr-station-map)
- [3D Pedestrian Route Search API](https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-pedestrian-route-search)
- [Official Lands Department logo](https://www.landsd.gov.hk/images/landsd_logo.svg), downloaded unmodified into `frontend/public/landsd-logo.svg` and displayed on the map.

**Map from Lands Department © Government of the Hong Kong Special Administrative Region.** The UI links to the department and displays the department logo. Data accuracy, completeness, availability and fitness are not guaranteed by the provider. Reuse is subject to the [LandsD Map API terms](https://portal.csdi.gov.hk/csdi-webpage/terms-and-conditions).

Frozen catalogs contain **689 building venues** and **98 MTR venues**. Six building candidates have saved levels, units, openings and amenities. Causeway Bay and Tseung Kwan O stations have saved MTR levels, openings and amenities. Coordinates in the WFS response are EPSG:4326.

The two scene packages retain official feature geometry and IDs for G/F and 1/F. Nearby venue polygons supply the optional local 3D extrusion view; displayed extrusion heights are deliberately scaled and capped for readability and are not a measured 3D city model.

## MTR Corporation Limited

[MTR routes, fares and barrier-free facilities](https://data.gov.hk/en-data/dataset/mtr-data-routes-fares-barrier-free-facilities) publishes the following saved files:

| File                               | Data rows | Fields                                                                                    |
| ---------------------------------- | --------: | ----------------------------------------------------------------------------------------- |
| barrier_free_facilities.csv        |      3564 | Station_No, Key, Value, AJTextEn, AJTextZh, Exit_Coordinate_X_Y                           |
| barrier_free_facility_category.csv |        36 | Item_Code, Category_Id, Category_En, Category_Zh, Facility_En, Facility_Zh, Sorting_Order |
| mtr_lines_and_stations.csv         |       273 | Line Code, Direction, Station Code, Station ID, Chinese Name, English Name, Sequence      |

The catalog advertises monthly updates; the above counts describe this frozen snapshot. Station ID can be matched to Station_No; Item_Code maps to the facility Key. These records are preserved as feasibility evidence, not treated as per-edge accessibility certification.

## Derived and manual data

- A local metric projection and 1.6m grid derive horizontal graph edges from official public walkway / lobby / lift / entry polygons. Every horizontal segment must be contained within their union with 0.25m tolerance. `provenance=derived`.
- Two vertically aligned elevator amenity pairs are chosen per venue. Pairing does not establish shaft service, public access, schedule or current operation. `provenance=manual/demo augmentation`.
- Default building endpoints are public corridor demo points. G/F corridor handoffs without attachable entry amenities are explicitly unverified.
- Station links are `manual/demo augmentation`. PopCorn 2 includes an official successful outdoor route baseline, plus unverified endpoint links. Hysan's chosen endpoint query returned a no-solution payload, retained as `hysan-place-outdoor-route.json`; its station link is a clearly marked demo line.
- All edges use `wheelchair=unknown`. A wheelchair route in permissive demo mode is **not** asserted to be physically accessible. Strict mode blocks unknown edges.
- Lift closures and rain contexts are simulated. No live real-world event is implied.

Raw data is not given the project's own software license. Downstream deployments must retain the above attributions and source metadata.
