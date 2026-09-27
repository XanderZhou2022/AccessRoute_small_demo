import type { Scene, RouteSegment, Feature } from '../../../shared/domain/schema';
export interface MapRendererProps {
  scene: Scene;
  segments: RouteSegment[];
  levelId?: string;
  closedFacilities: string[];
  zoom?: number;
}
export function FloorMap({
  scene,
  segments,
  levelId,
  closedFacilities,
  zoom = 1,
}: MapRendererProps) {
  const level = levelId || scene.manifest.levels[0].id;
  const floors = scene.levels.features.filter((f) => f.properties.level_id === level),
    units = scene.units.features.filter((f) => f.properties.level_id === level),
    openings = scene.openings.features.filter((f) => f.properties.level_id === level);
  const coordinates: number[][] = [];
  function collect(x: any) {
    if (typeof x[0] === 'number') coordinates.push(x);
    else x.forEach(collect);
  }
  floors.forEach((f) => collect(f.geometry.coordinates));
  if (!coordinates.length) return <p>此樓層沒有平面資料。</p>;
  const cos = Math.cos((scene.manifest.center[1] * Math.PI) / 180),
    xs = coordinates.map((p) => p[0] * cos),
    ys = coordinates.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const scale = Math.min(700 / (maxX - minX), 480 / (maxY - minY));
  const px = (p: number[]) => [
    (p[0] * cos - (minX + maxX) / 2) * scale + 420,
    ((minY + maxY) / 2 - p[1]) * scale + 300,
  ];
  function path(f: Feature) {
    const geom = f.geometry;
    if (geom.type === 'Polygon')
      return geom.coordinates
        .map(
          (ring: number[][]) =>
            ring.map((p, i) => `${i ? 'L' : 'M'}${px(p).join(',')}`).join(' ') + 'Z',
        )
        .join(' ');
    if (geom.type === 'MultiPolygon')
      return geom.coordinates
        .map((poly: any) => path({ ...f, geometry: { type: 'Polygon', coordinates: poly } }))
        .join(' ');
    if (geom.type === 'LineString')
      return geom.coordinates
        .map((p: number[], i: number) => `${i ? 'L' : 'M'}${px(p).join(',')}`)
        .join(' ');
    return '';
  }
  const route = segments.filter((s) => s.type === 'floor' && s.levelId === level);
  const lifts = scene.graph.nodes.filter((n) => n.kind === 'lift' && n.levelId === level);
  const amenity = scene.amenities.features.filter(
    (f) =>
      f.properties.level_id === level &&
      ['restroom.wheelchair', 'information', 'entry'].includes(f.properties.amenity_category),
  );
  return (
    <svg
      className="floor-svg"
      viewBox="0 0 840 600"
      role="img"
      aria-label={`${scene.manifest.nameZh} ${scene.manifest.levels.find((l) => l.id === level)?.label} 官方樓層平面圖及演示路線`}
    >
      <defs>
        <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".7" fill="#c8d3d4" />
        </pattern>
        <filter id="floor-shadow">
          <feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="#243f4c" floodOpacity=".10" />
        </filter>
      </defs>
      <rect width="840" height="600" fill="url(#grid)" />
      <g transform={`translate(420 300) scale(${zoom}) translate(-420 -300)`}>
        <g filter="url(#floor-shadow)">
          {floors.map((f, i) => (
            <path
              key={i}
              d={path(f)}
              fill="#fff"
              stroke="#bac8cc"
              strokeWidth="1.5"
              fillRule="evenodd"
            />
          ))}
        </g>
        {units.map((f, i) => (
          <path
            key={i}
            d={path(f)}
            fill={
              ['walkway', 'lobby', 'entry'].includes(f.properties.unit_category)
                ? '#fcfdfd'
                : f.properties.unit_category === 'elevator'
                  ? '#c9e9e4'
                  : f.properties.unit_category === 'opentobelow'
                    ? '#e8eef0'
                    : '#edf0f2'
            }
            stroke="#cdd5d9"
            strokeWidth=".65"
            fillRule="evenodd"
          >
            <title>{f.properties.unit_name_en || f.properties.unit_category}</title>
          </path>
        ))}
        {openings.map((f, i) => (
          <path key={i} d={path(f)} fill="none" stroke="#94c9c2" strokeWidth="1.5" />
        ))}
        {amenity.slice(0, 25).map((f, i) => {
          const [x, y] = px(f.geometry.coordinates);
          return (
            <g key={i} transform={`translate(${x},${y})`}>
              <circle r="7" fill="#f7fcfb" stroke="#9cafb4" />
              <text textAnchor="middle" y="3" fontSize="9" fill="#536b72">
                {f.properties.amenity_category === 'restroom.wheelchair'
                  ? '♿'
                  : f.properties.amenity_category === 'information'
                    ? 'i'
                    : '↗'}
              </text>
            </g>
          );
        })}
        {route.map((s) => (
          <g key={s.id}>
            <polyline
              points={s.geometry.map((p) => px(p).join(',')).join(' ')}
              fill="none"
              stroke="white"
              strokeWidth="9"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <polyline
              points={s.geometry.map((p) => px(p).join(',')).join(' ')}
              fill="none"
              stroke="#078e8a"
              strokeWidth="4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}
        {lifts.map((n) => {
          const [x, y] = px([n.lon, n.lat]);
          const closed = closedFacilities.includes(n.facilityId!);
          const f = scene.graph.facilities.find((f) => f.id === n.facilityId);
          return (
            <g key={n.id} transform={`translate(${x} ${y})`}>
              <rect
                x="-10"
                y="-10"
                width="20"
                height="20"
                rx="5"
                fill={closed ? '#c14b42' : '#087f8c'}
                stroke="white"
                strokeWidth="2"
              />
              <text textAnchor="middle" y="4" fontSize="12" fontWeight="700" fill="white">
                {closed ? '×' : f?.label.slice(-1)}
              </text>
              <title>
                {f?.label}
                {closed ? ' 暫停服務' : ''}
              </title>
            </g>
          );
        })}
        {route[0] &&
          (() => {
            const [x, y] = px(route[0].geometry[0]);
            return (
              <g transform={`translate(${x} ${y})`}>
                <circle r="13" fill="#0c8b89" opacity=".18" />
                <circle r="6" fill="#078e8a" stroke="white" strokeWidth="3" />
              </g>
            );
          })()}
      </g>
      <g transform="translate(746 44)">
        <path d="M0 23 7 0 14 23 7 17Z" fill="#355362" />
        <text x="7" y="-8" textAnchor="middle" fill="#355362" fontSize="13">
          N
        </text>
      </g>
    </svg>
  );
}
