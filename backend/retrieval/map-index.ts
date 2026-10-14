import type { Scene, MobilityNode, Feature } from '../../shared/domain/schema';
import type {
  LandmarkRecord,
  MapCandidate,
  PhotoInput,
  MapContext,
} from '../../shared/genai/workflows';
export const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
export function distance(a: { lon: number; lat: number }, b: { lon: number; lat: number }) {
  const radians = Math.PI / 180;
  const dy = (a.lat - b.lat) * radians;
  const dx = (a.lon - b.lon) * radians * Math.cos(((a.lat + b.lat) * radians) / 2);
  return Math.hypot(dx, dy) * 6371000;
}
function center(feature: Feature): { lon: number; lat: number } {
  if (feature.geometry.type === 'Point')
    return { lon: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1] };
  const box = feature.properties.bbox as number[];
  return { lon: (box[0] + box[2]) / 2, lat: (box[1] + box[3]) / 2 };
}
export function buildMapIndex(scene: Scene, directory: LandmarkRecord[]): MapCandidate[] {
  const nodes = new Map(scene.graph.nodes.map((n) => [n.id, n]));
  const entries: MapCandidate[] = [];
  const push = (record: Omit<MapCandidate, 'lon' | 'lat' | 'distance_m' | 'route_distance_m'>) => {
    const node = nodes.get(record.node_id)!;
    entries.push({ ...record, lon: node.lon, lat: node.lat, distance_m: 0, route_distance_m: 0 });
  };
  for (const landmark of directory) push({ ...landmark, node_id: landmark.node_id });
  // GeoJSON anchors attach to nearby public graph nodes, never to a shop's interior.
  const byLevel = new Map<string | undefined, MobilityNode[]>();
  for (const node of scene.graph.nodes) {
    if (['junction', 'entrance', 'poi'].includes(node.kind)) {
      const list = byLevel.get(node.levelId) || [];
      list.push(node);
      byLevel.set(node.levelId, list);
    }
  }
  for (const [layer, prefix] of [
    ['units', 'unit'],
    ['amenities', 'amenity'],
  ] as const) {
    for (const feature of scene[layer].features) {
      const p = feature.properties;
      const names = [
        p[`${prefix}_name_zh`],
        p[`${prefix}_name_en`],
        p[`${prefix}_alt_name`],
      ].filter((name): name is string => typeof name === 'string' && name.length > 0);
      if (!names.length) continue;
      const point = center(feature);
      const nearest = (byLevel.get(p.level_id) || [])
        .map((node) => ({ node, d: distance(node, point) }))
        .sort((a, b) => a.d - b.d)[0];
      if (!nearest || nearest.d > 20) continue;
      push({
        id: `${layer}:${p[`${prefix}_id`]}`,
        names,
        category: p[`${prefix}_category`],
        descriptions: [],
        source: `scene:${scene.manifest.sceneId}/${layer}.geojson`,
        node_id: nearest.node.id,
        level_id: nearest.node.levelId,
      });
    }
  }
  for (const facility of scene.graph.facilities) {
    const endpointIds = new Set(
      scene.graph.edges.filter((e) => e.facilityId === facility.id).flatMap((e) => [e.from, e.to]),
    );
    const attached = scene.graph.nodes.filter(
      (n) => n.facilityId === facility.id || endpointIds.has(n.id),
    );
    for (const node of attached)
      push({
        id: `facility:${facility.id}:${node.id}`,
        names: [facility.label],
        category: facility.kind,
        descriptions: [],
        source: 'scene:graph.facilities',
        node_id: node.id,
        level_id: node.levelId,
        facility_id: facility.id,
      });
  }
  for (const edge of scene.graph.edges.filter((e) => !e.facilityId)) {
    const a = nodes.get(edge.from)!;
    push({
      id: `edge:${edge.id}`,
      names: [
        edge.kind === 'corridor'
          ? '走廊'
          : edge.kind === 'outdoor'
            ? '室外通道'
            : edge.kind === 'bridge'
              ? '接駁通道'
              : edge.kind,
      ],
      category: edge.kind,
      descriptions: [
        edge.kind === 'corridor'
          ? '走廊 corridor'
          : edge.kind === 'outdoor'
            ? '室外通道 outdoor path'
            : edge.kind,
      ],
      source: 'scene:graph.edges',
      node_id: a.id,
      level_id: a.levelId,
      edge_ids: [edge.id],
    });
    // The coordinate for spatial matching is the edge midpoint, its node remains a graph endpoint.
    const b = nodes.get(edge.to)!;
    entries[entries.length - 1].lon = (a.lon + b.lon) / 2;
    entries[entries.length - 1].lat = (a.lat + b.lat) / 2;
  }
  return entries;
}
export function retrieveNearby(
  scene: Scene,
  index: MapCandidate[],
  context: MapContext,
  photo: Omit<PhotoInput, 'image'>,
  target: 'landmark' | 'lift' | 'facility' | 'path',
) {
  const current = scene.graph.nodes.find((n) => n.id === context.input.current_node_id)!;
  const location = photo.position ? { lon: photo.position.lon, lat: photo.position.lat } : current;
  const radius = photo.position ? Math.max(60, photo.position.accuracy_m * 2) : 120;
  const routeNodes = context.segments
    .flatMap((s) => s.nodeIds)
    .map((id) => scene.graph.nodes.find((n) => n.id === id)!);
  return index
    .filter(
      (candidate) =>
        (target === 'lift'
          ? candidate.category === 'lift' && !!candidate.facility_id
          : target === 'facility'
            ? !!candidate.facility_id
            : target === 'path'
              ? !!candidate.edge_ids
              : !candidate.edge_ids) &&
        (!photo.level_id || candidate.level_id === photo.level_id),
    )
    .map((candidate) => ({
      ...candidate,
      distance_m: distance(candidate, location),
      route_distance_m: routeNodes.length
        ? Math.min(
            ...routeNodes
              .filter((n) => n.levelId === candidate.level_id)
              .map((n) => distance(candidate, n)),
          )
        : Infinity,
    }))
    .filter((candidate) => candidate.distance_m <= radius)
    .sort((a, b) => a.distance_m - b.distance_m);
}
