import type { MobilityEdge, RoutingContext, DynamicEvent } from '../domain/schema';
export interface RoutingPolicyPlugin {
  id: string;
  evaluate(
    edge: MobilityEdge,
    ctx: RoutingContext,
  ): { blocked?: boolean; penalty?: number; reasonCode?: string };
}
export function eventIsActive(e: DynamicEvent, now: string) {
  const t = Date.parse(now);
  return (
    e.status === 'active' &&
    Date.parse(e.validFrom) <= t &&
    (!e.validUntil || t < Date.parse(e.validUntil))
  );
}
export const accessibilityPolicy: RoutingPolicyPlugin = {
  id: 'accessibility',
  evaluate(e, c) {
    const wheelchair = c.profile === 'wheelchair';
    const defaultStepFree = ['wheelchair', 'stroller', 'heavy_luggage'].includes(c.profile);
    const stairsAllowed =
      !wheelchair &&
      (c.allowStairs ?? (c.avoidStairs === false || !defaultStepFree)) &&
      !c.avoidStairs;
    const escalatorsAllowed =
      !wheelchair && (c.allowEscalators ?? (!defaultStepFree && !c.avoidStairs));
    if ((e.kind === 'stairs' && !stairsAllowed) || (e.kind === 'escalator' && !escalatorsAllowed))
      return { blocked: true, reasonCode: 'STEP_FREE_REQUIRED' };
    if (c.avoidLifts && e.kind === 'lift') return { blocked: true, reasonCode: 'LIFT_AVOIDED' };
    if (e.wheelchair === 'no' && wheelchair)
      return { blocked: true, reasonCode: 'NOT_WHEELCHAIR_ACCESSIBLE' };
    if (c.strictAccessibility && e.wheelchair === 'unknown')
      return { blocked: true, reasonCode: 'ACCESSIBILITY_UNVERIFIED' };
    const maxSlope =
      c.maxSlope ?? (wheelchair || defaultStepFree || c.avoidSteepSlopes ? 0.0833 : Infinity);
    if (e.slope !== undefined && Math.abs(e.slope) > maxSlope)
      return { blocked: true, reasonCode: 'SLOPE_LIMIT' };
    if (c.minWidthM !== undefined && e.widthM !== undefined && e.widthM < c.minWidthM)
      return { blocked: true, reasonCode: 'WIDTH_LIMIT' };
    if (
      c.maxStepsPerFlight !== undefined &&
      e.kind === 'stairs' &&
      (e.stepCount ?? Infinity) > c.maxStepsPerFlight
    )
      return { blocked: true, reasonCode: 'STEP_LIMIT' };
    if (
      c.strictAccessibility &&
      ((c.minWidthM !== undefined && e.widthM === undefined) ||
        (c.maxSlope !== undefined &&
          ['ramp', 'outdoor', 'bridge'].includes(e.kind) &&
          e.slope === undefined))
    )
      return { blocked: true, reasonCode: 'DIMENSIONS_UNVERIFIED' };
    if (
      (e.openFrom && Date.parse(c.now) < Date.parse(e.openFrom)) ||
      (e.openUntil && Date.parse(c.now) >= Date.parse(e.openUntil))
    )
      return { blocked: true, reasonCode: 'OUTSIDE_OPENING_HOURS' };
    const effort = c.objective === 'least_effort' ? 4 : 1;
    const penalty =
      c.objective === 'shortest'
        ? 0
        : (e.wheelchair === 'unknown' ? 20 : 0) +
          (e.kind === 'stairs' ? (c.profile === 'walking' ? 25 : 180) * effort : 0) +
          (e.kind === 'escalator' ? 8 * effort : 0) +
          (e.kind === 'lift' ? 12 : 0) +
          Math.abs(e.slope ?? 0) * e.distanceM * (c.profile === 'walking' ? 2 : 12) * effort;
    return {
      penalty,
      reasonCode: e.wheelchair === 'unknown' ? 'ACCESSIBILITY_UNVERIFIED' : undefined,
    };
  },
};
export const weatherPolicy: RoutingPolicyPlugin = {
  id: 'weather',
  evaluate(e, c) {
    return {
      penalty:
        c.objective !== 'shortest' &&
        (c.rain || c.preferCoveredShelter) &&
        !e.indoor &&
        !e.sheltered
          ? e.distanceM * 2
          : 0,
      reasonCode:
        (c.rain || c.preferCoveredShelter) && !e.indoor && !e.sheltered
          ? c.rain
            ? 'RAIN_EXPOSURE'
            : 'UNCOVERED_EXPOSURE'
          : undefined,
    };
  },
};
export const eventPolicy: RoutingPolicyPlugin = {
  id: 'events',
  evaluate(e, c) {
    let penalty = 0;
    for (const event of c.events) {
      if (!eventIsActive(event, c.now)) continue;
      const match =
        (!!event.target.facilityId && event.target.facilityId === e.facilityId) ||
        event.target.edgeIds?.includes(e.id);
      if (!match) continue;
      if (event.type === 'facility_closed' || event.type === 'construction')
        return { blocked: true, reasonCode: 'FACILITY_CLOSED' };
      if (event.type === 'custom' && event.metadata?.blocked === true)
        return { blocked: true, reasonCode: 'CUSTOM_CLOSURE' };
      if (event.type === 'crowding' && c.objective !== 'shortest') penalty += 50;
    }
    return penalty ? { penalty, reasonCode: 'CROWDING' } : {};
  },
};
export const defaultPolicies = [accessibilityPolicy, eventPolicy, weatherPolicy];
export function effectiveCost(e: MobilityEdge, c: RoutingContext, plugins: RoutingPolicyPlugin[]) {
  let cost = e.distanceM;
  const reasons: string[] = [];
  for (const p of plugins) {
    const r = p.evaluate(e, c);
    if (r.reasonCode) reasons.push(r.reasonCode);
    if (r.blocked) return { cost: Infinity, reasons };
    if (r.penalty !== undefined && (!Number.isFinite(r.penalty) || r.penalty < 0))
      throw new Error(`Policy ${p.id}: penalties must be finite and nonnegative`);
    cost += r.penalty || 0;
  }
  return { cost, reasons };
}
