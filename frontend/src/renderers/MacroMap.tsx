import { useEffect, useRef, useState } from 'react';
import type { MapRendererProps } from './FloorMap';
import type { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { endpoints, segmentColor, transitionColor, transitionText } from './routePresentation';
/** Macro adapter: local GeoJSON only, no tiles, tokens or external requests. */
export default function MacroMap({
  scene,
  segments,
  routeSegments = segments,
  closedFacilities,
  highlight,
}: MapRendererProps) {
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
                    properties: {
                      color: segmentColor(scene, s),
                      transition: s.type === 'transition',
                    },
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
              paint: { 'line-color': ['get', 'color'], 'line-width': 5 },
              layout: { 'line-cap': 'round', 'line-join': 'round' },
            });
            for (const point of endpoints(scene, routeSegments)) {
              const marker = document.createElement('div');
              marker.className = 'map-endpoint';
              marker.style.setProperty('--marker-color', point.color);
              const badge = document.createElement('span');
              badge.className = 'endpoint-badge';
              badge.textContent = point.role;
              const label = document.createElement('span');
              label.className = 'endpoint-detail';
              label.textContent = point.detail;
              marker.append(badge, label);
              marker.setAttribute('aria-label', `${point.role}：${point.detail}`);
              new ml.Marker({
                element: marker,
                anchor: point.role === '起點' ? 'top' : 'bottom',
                offset: point.role === '起點' ? [0, 12] : [25, -22],
              })
                .setLngLat([point.node.lon, point.node.lat])
                .addTo(m);
            }
            for (const s of segments.filter((s) => s.type === 'transition')) {
              const node = scene.graph.nodes.find((n) => n.id === s.nodeIds[0]);
              if (!node) continue;
              const marker = document.createElement('div');
              marker.className = 'map-transition';
              marker.textContent = `↕ ${transitionText(scene, s)}`;
              marker.setAttribute('aria-label', transitionText(scene, s));
              const facility = scene.graph.facilities.find((f) => f.id === s.facilityId);
              marker.title = facility?.label || '樓層轉換';
              new ml.Marker({ element: marker, anchor: 'bottom-left', offset: [12, -22] })
                .setLngLat([node.lon, node.lat])
                .addTo(m);
            }
            if (highlight) {
              m.addSource('candidate', {
                type: 'geojson',
                data: {
                  type: 'FeatureCollection',
                  features: [
                    {
                      type: 'Feature',
                      properties: {},
                      geometry: { type: 'Point', coordinates: [highlight.lon, highlight.lat] },
                    },
                  ],
                },
              });
              m.addLayer({
                id: 'candidate-point',
                type: 'circle',
                source: 'candidate',
                paint: {
                  'circle-radius': 10,
                  'circle-color': '#ea580c',
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': 3,
                },
              });
            }
            const bounds = new ml.LngLatBounds();
            segments.flatMap((s) => s.geometry).forEach((p) => bounds.extend(p));
            if (!bounds.isEmpty())
              m.fitBounds(bounds, { padding: 100, maxZoom: 18.8, duration: 0 });
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
  }, [scene, segments, routeSegments, highlight]);
  if (failed)
    return (
      <MacroFallback
        scene={scene}
        segments={segments}
        routeSegments={routeSegments}
        closedFacilities={closedFacilities}
        highlight={highlight}
      />
    );
  return <div className="macro-map" ref={el} aria-label="本地官方建築輪廓立體地圖" />;
}
function MacroFallback({ scene, segments, routeSegments = segments, highlight }: MapRendererProps) {
  const cx = scene.manifest.center[0],
    cy = scene.manifest.center[1];
  const xy = (p: number[]) => [420 + (p[0] - cx) * 180000, 300 - (p[1] - cy) * 180000];
  return (
    <svg className="floor-svg" viewBox="0 0 840 600" role="img" aria-label="本地平面地圖">
      <rect width="840" height="600" fill="#e7f0f0" />
      {scene.surroundings.features.map((f, i) => {
        const polygons =
          f.geometry.type === 'Polygon'
            ? [f.geometry.coordinates]
            : f.geometry.type === 'MultiPolygon'
              ? f.geometry.coordinates
              : [];
        return (
          <path
            key={i}
            d={polygons
              .flatMap((polygon: number[][][]) =>
                polygon.map(
                  (ring) =>
                    ring.map((p, j) => `${j ? 'L' : 'M'}${xy(p).join(' ')}`).join(' ') + ' Z',
                ),
              )
              .join(' ')}
            fillRule="evenodd"
            fill={f.properties.venue_id === scene.manifest.venueId ? '#9cbfba' : '#d0dfe0'}
            stroke="#b5caca"
          />
        );
      })}
      {segments.map((s) => (
        <polyline
          key={s.id}
          points={s.geometry.map((p) => xy(p).join(',')).join(' ')}
          fill="none"
          stroke={segmentColor(scene, s)}
          strokeWidth="4"
        />
      ))}
      {segments
        .filter((s) => s.type === 'transition')
        .map((s) => {
          const node = scene.graph.nodes.find((n) => n.id === s.nodeIds[0]);
          if (!node) return null;
          const [x, y] = xy([node.lon, node.lat]);
          return (
            <g key={s.id} transform={`translate(${x} ${y})`}>
              <circle r="9" fill={transitionColor} />
              <text
                x="14"
                y="-12"
                fontSize="12"
                fill={transitionColor}
                stroke="white"
                strokeWidth="3"
                paintOrder="stroke"
              >
                {transitionText(scene, s)}
              </text>
            </g>
          );
        })}
      {endpoints(scene, routeSegments).map((p) => {
        const [x, y] = xy([p.node.lon, p.node.lat]);
        return (
          <g key={p.role} transform={`translate(${x} ${y})`}>
            <circle r="8" fill={p.color} stroke="white" strokeWidth="3" />
            <text
              x="12"
              y="18"
              fontSize="12"
              fill={p.color}
              stroke="white"
              strokeWidth="3"
              paintOrder="stroke"
            >
              {p.role}：{p.detail}
            </text>
          </g>
        );
      })}
      {highlight && (
        <circle
          cx={xy([highlight.lon, highlight.lat])[0]}
          cy={xy([highlight.lon, highlight.lat])[1]}
          r="10"
          fill="#ea580c"
          stroke="white"
          strokeWidth="3"
        >
          <title>候選位置：{highlight.label}</title>
        </circle>
      )}
      <text x="24" y="570" fill="#486369" fontSize="14">
        本地平面模式 · 立體顯示不可用
      </text>
    </svg>
  );
}
