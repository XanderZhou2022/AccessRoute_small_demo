import { useEffect, useRef, useState } from 'react';
import type { MapRendererProps } from './FloorMap';
import type { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
/** Macro adapter: local GeoJSON only, no tiles, tokens or external requests. */
export default function MacroMap({ scene, segments, closedFacilities }: MapRendererProps) {
  const el = useRef<HTMLDivElement>(null),
    map = useRef<MapLibreMap | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let canceled = false;
    let resizeObserver: ResizeObserver | undefined;
    setFailed(false);
    import('maplibre-gl')
      .then(({ default: ml }) => {
        if (canceled || !el.current) return;
        try {
          const m = new ml.Map({
            container: el.current,
            style: {
              version: 8,
              sources: {},
              layers: [
                { id: 'background', type: 'background', paint: { 'background-color': '#e7f0f0' } },
              ],
            },
            center: scene.manifest.center,
            zoom: 17,
            pitch: 47,
            bearing: -22,
            attributionControl: false,
          });
          map.current = m;
          resizeObserver = new ResizeObserver(() => m.resize());
          resizeObserver.observe(el.current);
          m.addControl(new ml.NavigationControl({ showCompass: true }), 'top-right');
          m.on('error', () => setFailed(true));
          m.on('load', () => {
            if (canceled) return;
            const buildings = {
              ...scene.surroundings,
              features: scene.surroundings.features.map((f) => ({
                ...f,
                properties: {
                  ...f.properties,
                  selected: f.properties.venue_id === scene.manifest.venueId ? 1 : 0,
                  height: Math.max(
                    6,
                    Math.min(
                      22,
                      (Number(f.properties.venue_display_height || 20) -
                        Number(f.properties.venue_display_height_min || 0)) *
                        0.3,
                    ),
                  ),
                },
              })),
            };
            m.addSource('buildings', { type: 'geojson', data: buildings as any });
            m.addLayer({
              id: 'blocks',
              type: 'fill-extrusion',
              source: 'buildings',
              paint: {
                'fill-extrusion-color': [
                  'case',
                  ['==', ['get', 'selected'], 1],
                  '#5d9895',
                  '#c5d5d6',
                ],
                'fill-extrusion-height': ['get', 'height'],
                'fill-extrusion-opacity': 0.7,
                'fill-extrusion-base': 0,
              },
            });
            m.addSource('route', {
              type: 'geojson',
              data: {
                type: 'FeatureCollection',
                features: segments
                  .filter((s) => s.geometry.length > 1)
                  .map((s) => ({
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'LineString', coordinates: s.geometry },
                  })),
              },
            });
            m.addLayer({
              id: 'route-white',
              type: 'line',
              source: 'route',
              paint: { 'line-color': '#ffffff', 'line-width': 10 },
              layout: { 'line-cap': 'round', 'line-join': 'round' },
            });
            m.addLayer({
              id: 'route-line',
              type: 'line',
              source: 'route',
              paint: { 'line-color': '#008c86', 'line-width': 5 },
              layout: { 'line-cap': 'round', 'line-join': 'round' },
            });
            const pois = scene.graph.nodes.filter((n) => ['stop', 'poi'].includes(n.kind));
            for (const n of pois) {
              const marker = document.createElement('div');
              marker.className = 'map-marker';
              marker.textContent = n.kind === 'stop' ? 'M' : '●';
              marker.title = n.label || '';
              new ml.Marker({ element: marker }).setLngLat([n.lon, n.lat]).addTo(m);
            }
            const bounds = new ml.LngLatBounds();
            segments.flatMap((s) => s.geometry).forEach((p) => bounds.extend(p));
            if (!bounds.isEmpty())
              m.fitBounds(bounds, { padding: 100, maxZoom: 17.3, duration: 0 });
          });
        } catch {
          setFailed(true);
        }
      })
      .catch(() => setFailed(true));
    return () => {
      canceled = true;
      resizeObserver?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, [scene, segments]);
  if (failed)
    return <MacroFallback scene={scene} segments={segments} closedFacilities={closedFacilities} />;
  return <div className="macro-map" ref={el} aria-label="本地官方建築輪廓立體地圖" />;
}
function MacroFallback({ scene, segments }: MapRendererProps) {
  const pts = scene.surroundings.features.flatMap((f) =>
    f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : [],
  );
  const cx = scene.manifest.center[0],
    cy = scene.manifest.center[1];
  const xy = (p: number[]) => [420 + (p[0] - cx) * 180000, 300 - (p[1] - cy) * 180000];
  return (
    <svg className="floor-svg" viewBox="0 0 840 600" role="img" aria-label="本地平面地圖">
      <rect width="840" height="600" fill="#e7f0f0" />
      {pts.length > 0 &&
        scene.surroundings.features
          .filter((f) => f.geometry.type === 'Polygon')
          .map((f, i) => (
            <polygon
              key={i}
              points={f.geometry.coordinates[0].map((p: number[]) => xy(p).join(',')).join(' ')}
              fill={f.properties.venue_id === scene.manifest.venueId ? '#9cbfba' : '#d0dfe0'}
              stroke="#b5caca"
            />
          ))}
      {segments.map((s) => (
        <polyline
          key={s.id}
          points={s.geometry.map((p) => xy(p).join(',')).join(' ')}
          fill="none"
          stroke="#087f8c"
          strokeWidth="4"
        />
      ))}
      <text x="24" y="570" fill="#486369" fontSize="14">
        本地平面模式 · 立體顯示不可用
      </text>
    </svg>
  );
}
