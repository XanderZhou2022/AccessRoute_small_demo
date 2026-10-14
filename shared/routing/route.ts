import type { MobilityGraph, RoutingContext, RouteResult } from '../domain/schema';
import { effectiveCost, defaultPolicies, type RoutingPolicyPlugin } from './policies';
import { durationS, routeMetrics } from './metrics';
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
  const requestedObjective = ctx.objective ?? 'balanced';
  const objective =
    requestedObjective === 'balanced' && (ctx.rain || ctx.preferCoveredShelter)
      ? 'sheltered'
      : requestedObjective;
  // Lexicographic optimisation: minimum exposure first, then cost. No arbitrary weather weight.
  const primaryCost = (edge: MobilityGraph['edges'][number]) =>
    objective === 'sheltered'
      ? !edge.indoor && !edge.sheltered
        ? edge.distanceM
        : 0
      : objective === 'indoor'
        ? !edge.indoor
          ? edge.distanceM
          : 0
        : 0;
  const primary = new Map([[from, 0]]);
  const adjacency = new Map<
    string,
    { to: string; edge: number; cost: number; reasons: string[] }[]
  >();
  const blocked = new Set<string>();
  graph.edges.forEach((e, i) => {
    const result = effectiveCost(e, ctx, plugins);
    if (objective === 'fastest' && Number.isFinite(result.cost))
      result.cost = durationS(e, ctx) + result.cost - e.distanceM;
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
  const queue = new MinHeap();
  queue.push({ id: from, primary: 0, cost: 0 });
  while (queue.size) {
    const entry = queue.pop()!;
    const current = entry.id,
      best = entry.cost;
    if (
      done.has(current) ||
      best !== distances.get(current) ||
      entry.primary !== primary.get(current)
    )
      continue;
    if (current === to) break;
    done.add(current);
    for (const e of adjacency.get(current) || []) {
      const alt = best + e.cost;
      const p = entry.primary + primaryCost(graph.edges[e.edge]);
      const oldPrimary = primary.get(e.to) ?? Infinity;
      if (p < oldPrimary || (p === oldPrimary && alt < (distances.get(e.to) ?? Infinity))) {
        primary.set(e.to, p);
        distances.set(e.to, alt);
        prev.set(e.to, { from: current, edge: e.edge, reasons: e.reasons });
        queue.push({ id: e.to, primary: p, cost: alt });
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
    metrics: routeMetrics(graph, edgeIds, nodeIds, ctx),
  };
}

// Binary heap keeps large indoor graphs at O((V + E) log V).
type Entry = { id: string; primary: number; cost: number };
class MinHeap {
  private entries: Entry[] = [];
  get size() {
    return this.entries.length;
  }
  private less(a: Entry, b: Entry) {
    return a.primary < b.primary || (a.primary === b.primary && a.cost < b.cost);
  }
  push(entry: Entry) {
    this.entries.push(entry);
    let i = this.entries.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(this.entries[i], this.entries[p])) break;
      [this.entries[i], this.entries[p]] = [this.entries[p], this.entries[i]];
      i = p;
    }
  }
  pop() {
    const first = this.entries[0],
      last = this.entries.pop()!;
    if (this.entries.length) {
      this.entries[0] = last;
      let i = 0;
      while (true) {
        let child = i * 2 + 1;
        if (child >= this.entries.length) break;
        if (
          child + 1 < this.entries.length &&
          this.less(this.entries[child + 1], this.entries[child])
        )
          child++;
        if (!this.less(this.entries[child], this.entries[i])) break;
        [this.entries[i], this.entries[child]] = [this.entries[child], this.entries[i]];
        i = child;
      }
    }
    return first;
  }
}

/** Distinct feasible candidates under the same hard constraints and current events. */
export function planRoutes(graph: MobilityGraph, from: string, to: string, ctx: RoutingContext) {
  const seen = new Set<string>();
  return [
    ctx.objective ?? (ctx.rain || ctx.preferCoveredShelter ? 'sheltered' : 'balanced'),
    'shortest',
    'sheltered',
    'indoor',
    'least_effort',
    'fastest',
  ]
    .filter((v, i, all) => all.indexOf(v) === i)
    .flatMap((objective) => {
      const result = route(graph, from, to, {
        ...ctx,
        objective: objective as RoutingContext['objective'],
      });
      if (result.status !== 'ok') return [];
      const key = result.edgeIds.join('|');
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ objective, route: result }];
    });
}
