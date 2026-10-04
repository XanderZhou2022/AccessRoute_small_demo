# Visualization decision

Use **MapLibre GL JS with local GeoJSON fill-extrusion** for the macro view, and **SVG** for official floor plans. React loads MapLibre lazily. No base-map tiles, tokens, remote fonts or CDN assets are required during the demo.

Reasons: keys and live 3D tile reliability are unnecessary dependencies for the overnight deliverable; local building footprints convey the building/transport relationship and SVG makes floor, openings, unit outlines, route and lift markers inspectable. Heights are scaled/capped for clarity and labeled as local geometry rather than photorealistic city data.

Macro map renders route output and official nearby venue polygons. Floor map renders official polygons with holes, unit classes, opening lines and selected amenity markers, then overlays the route and per-floor lift nodes. Both operate on the same route segment contract.

If WebGL or the map import fails, MacroMap uses the local SVG schematic fallback. Indoor rendering and routing remain independent. Map face includes the Lands Department logo and source copyright. Keyboard focus, responsive layouts, 44px main actions, readable controls and reduced-motion styles are included.

Final visual inspection must cover desktop overview, floor transition and narrow mobile view. Evidence and limits are recorded in `docs/acceptance.md`.

## Floor-aware route presentation (2026-10-04)

The overview projects routes onto the building context. Each floor uses a stable colour shared with the floor view; outdoor connectors are slate and footbridges blue. Orange callouts give the vertical transport mode, travel direction, and source/target floors. Endpoint markers name the local start and end, including station names, instead of using A/B or M. The ordered route cards provide distance and colour keys and let users inspect floors without advancing simulated navigation. Actual transitions determine the displayed device and up/down direction; the presentation does not introduce stairs into a step-free route.
