import type { MobilityGraph, RouteSegment } from '../domain/schema';

export type GuidanceChunk = Pick<RouteSegment, 'nodeIds' | 'edgeIds' | 'distanceM'>;

export function guidanceChunks(
  graph: MobilityGraph,
  segment: RouteSegment,
  walkingSpeedMps: number,
): GuidanceChunk[] {
  if (segment.type === 'transition' || segment.edgeIds.length < 2) {
    return [
      {
        nodeIds: segment.nodeIds,
        edgeIds: segment.edgeIds,
        distanceM: segment.distanceM,
      },
    ];
  }

  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const targetDistanceM = Math.max(15, walkingSpeedMps * 90);
  const chunks: GuidanceChunk[] = [];
  let startIndex = 0;
  let distanceM = 0;

  for (let index = 0; index < segment.edgeIds.length; index += 1) {
    const edge = edges.get(segment.edgeIds[index]);
    if (!edge) throw new Error(`Route segment references unknown edge: ${segment.edgeIds[index]}`);
    distanceM += edge.distanceM;

    if (distanceM >= targetDistanceM || index === segment.edgeIds.length - 1) {
      chunks.push({
        nodeIds: segment.nodeIds.slice(startIndex, index + 2),
        edgeIds: segment.edgeIds.slice(startIndex, index + 1),
        distanceM,
      });
      startIndex = index + 1;
      distanceM = 0;
    }
  }

  return chunks;
}
