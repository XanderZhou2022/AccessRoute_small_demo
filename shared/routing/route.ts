import type { MobilityGraph, RoutingContext, RouteResult } from '../domain/schema';
import { effectiveCost, defaultPolicies, type RoutingPolicyPlugin } from './policies';
/** Pure Dijkstra over an immutable base graph. Policies may only add nonnegative costs. */
export function route(
  graph: MobilityGraph,
  from: string,
  to: string,
  ctx: RoutingContext,
  plugins: RoutingPolicyPlugin[] = defaultPolicies,
): RouteResult {
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (!ids.has(from) || !ids.has(to)) throw new Error('Unknown route endpoint');
  if (new Set(plugins.map((p) => p.id)).size !== plugins.length)
    throw new Error('Duplicate policy ID');
  const adjacency = new Map<
    string,
    { to: string; edge: number; cost: number; reasons: string[] }[]
  >();
  const blocked = new Set<string>();
  graph.edges.forEach((e, i) => {
    const result = effectiveCost(e, ctx, plugins);
    if (!Number.isFinite(result.cost)) {
      result.reasons.forEach((r) => blocked.add(r));
      return;
    }
    const add = (a: string, b: string) => {
      if (!adjacency.has(a)) adjacency.set(a, []);
      adjacency.get(a)!.push({ to: b, edge: i, ...result });
    };
    add(e.from, e.to);
    if (e.bidirectional) add(e.to, e.from);
  });
  const distances = new Map([[from, 0]]),
    prev = new Map<string, { from: string; edge: number; reasons: string[] }>(),
    done = new Set<string>();
  while (true) {
    let current: string | undefined,
      best = Infinity;
    for (const [id, d] of distances)
      if (!done.has(id) && d < best) {
        best = d;
        current = id;
      }
    if (current === undefined) break;
    if (current === to) break;
    done.add(current);
    for (const e of adjacency.get(current) || []) {
      const alt = best + e.cost;
      if (alt < (distances.get(e.to) ?? Infinity)) {
        distances.set(e.to, alt);
        prev.set(e.to, { from: current, edge: e.edge, reasons: e.reasons });
      }
    }
  }
  if (!distances.has(to))
    return { status: 'no_route', reasonCodes: ['NO_ACCESSIBLE_ROUTE', ...blocked], warnings: [] };
  const nodeIds = [to],
    edgeIds: string[] = [],
    reasons = new Set<string>(),
    warnings = new Set<string>();
  let current = to,
    distanceM = 0;
  while (current !== from) {
    const p = prev.get(current)!;
    const e = graph.edges[p.edge];
    edgeIds.unshift(e.id);
    nodeIds.unshift(p.from);
    distanceM += e.distanceM;
    p.reasons.forEach((r) => reasons.add(r));
    if (e.provenance === 'manual/demo augmentation') warnings.add('DEMO_CONNECTION');
    if (e.wheelchair === 'unknown') warnings.add('ACCESSIBILITY_UNVERIFIED');
    current = p.from;
  }
  return {
    status: 'ok',
    nodeIds,
    edgeIds,
    distanceM,
    cost: distances.get(to)!,
    reasonCodes: [...reasons],
    warnings: [...warnings],
  };
}
