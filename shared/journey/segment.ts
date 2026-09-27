import type { MobilityGraph, RouteResult, RouteSegment } from '../domain/schema';
export function segmentRoute(graph: MobilityGraph, result: RouteResult): RouteSegment[] {
  if (result.status !== 'ok') return [];
  const nodes = new Map(graph.nodes.map((n) => [n.id, n])),
    edges = new Map(graph.edges.map((e) => [e.id, e]));
  const out: RouteSegment[] = [];
  result.edgeIds.forEach((id, i) => {
    const e = edges.get(id)!,
      a = nodes.get(result.nodeIds[i])!,
      b = nodes.get(result.nodeIds[i + 1])!;
    const vertical =
      a.levelId !== b.levelId && ['lift', 'stairs', 'ramp', 'escalator'].includes(e.kind);
    const type = vertical
      ? 'transition'
      : e.kind === 'outdoor'
        ? 'outdoor'
        : e.kind === 'bridge'
          ? 'bridge'
          : 'floor';
    let geom =
      e.geometry ||
      ([
        [a.lon, a.lat],
        [b.lon, b.lat],
      ] as [number, number][]);
    if (e.from !== a.id && e.geometry) geom = [...geom].reverse();
    const last = out[out.length - 1];
    if (
      type !== 'transition' &&
      last &&
      last.type === type &&
      (type !== 'floor' || (last.levelId === a.levelId && last.venueId === a.venueId))
    ) {
      last.nodeIds.push(b.id);
      last.edgeIds.push(id);
      last.geometry.push(...geom.slice(1));
      last.distanceM += e.distanceM;
    } else
      out.push({
        id: `segment-${out.length}`,
        sceneId: graph.sceneId,
        type,
        venueId: a.venueId,
        levelId: type === 'floor' ? a.levelId : undefined,
        nodeIds: [a.id, b.id],
        edgeIds: [id],
        geometry: geom,
        distanceM: e.distanceM,
        ...(vertical
          ? {
              facilityId: e.facilityId,
              mode: e.kind as RouteSegment['mode'],
              fromLevel: a.levelId,
              toLevel: b.levelId,
            }
          : {}),
      });
  });
  return out;
}
