import type { MobilityEdge, MobilityGraph, RoutingContext } from '../domain/schema';
export function durationS(edge: MobilityEdge, context: RoutingContext) {
  const speed =
    context.walkingSpeedMps ??
    { walking: 1.3, wheelchair: 0.8, elderly: 0.7, stroller: 0.9, heavy_luggage: 0.8 }[
      context.profile
    ];
  return (
    (edge.durationS ??
      (edge.kind === 'lift'
        ? 8 + edge.distanceM / 1.5
        : (edge.distanceM / speed) *
          (edge.kind === 'stairs'
            ? 2
            : edge.kind === 'ramp'
              ? 1 + Math.abs(edge.slope ?? 0) * 6
              : 1))) + (edge.waitS ?? (edge.kind === 'lift' ? 20 : 0))
  );
}
export function routeMetrics(
  graph: MobilityGraph,
  edgeIds: string[],
  nodeIds: string[],
  context: RoutingContext,
) {
  const edges = new Map(graph.edges.map((e) => [e.id, e]));
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const metrics = {
    exposedM: 0,
    outdoorM: 0,
    indoorM: 0,
    shelteredM: 0,
    estimatedDurationS: 0,
    ascentM: 0,
    descentM: 0,
    stairs: 0,
    transitions: {} as Record<string, number>,
  };
  edgeIds.forEach((id, i) => {
    const edge = edges.get(id)!;
    if (edge.indoor) metrics.indoorM += edge.distanceM;
    else metrics.outdoorM += edge.distanceM;
    if (edge.indoor || edge.sheltered) metrics.shelteredM += edge.distanceM;
    else metrics.exposedM += edge.distanceM;
    metrics.estimatedDurationS += durationS(edge, context);
    if (edge.kind === 'stairs') metrics.stairs += edge.stepCount ?? 0;
    const a = nodes.get(nodeIds[i])!,
      b = nodes.get(nodeIds[i + 1])!;
    if (a.levelId !== b.levelId && ['lift', 'ramp', 'stairs', 'escalator'].includes(edge.kind)) {
      metrics.transitions[edge.kind] = (metrics.transitions[edge.kind] ?? 0) + 1;
      const dz = (b.z ?? 0) - (a.z ?? 0);
      metrics.ascentM += Math.max(0, dz);
      metrics.descentM += Math.max(0, -dz);
    }
  });
  return metrics;
}
