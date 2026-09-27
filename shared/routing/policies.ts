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
    if (c.profile !== 'elderly' && ['stairs', 'escalator'].includes(e.kind))
      return { blocked: true, reasonCode: 'STEP_FREE_REQUIRED' };
    if (e.wheelchair === 'no' && c.profile === 'wheelchair')
      return { blocked: true, reasonCode: 'NOT_WHEELCHAIR_ACCESSIBLE' };
    if (c.strictAccessibility && e.wheelchair === 'unknown')
      return { blocked: true, reasonCode: 'ACCESSIBILITY_UNVERIFIED' };
    if (c.profile === 'wheelchair' && e.slope !== undefined && Math.abs(e.slope) > 0.0833)
      return { blocked: true, reasonCode: 'SLOPE_LIMIT' };
    const penalty =
      (e.wheelchair === 'unknown' ? 20 : 0) +
      (e.kind === 'stairs' ? 180 : 0) +
      (e.kind === 'lift' ? 12 : 0);
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
      penalty: c.rain && !e.indoor && !e.sheltered ? e.distanceM * 2 : 0,
      reasonCode: c.rain && !e.indoor && !e.sheltered ? 'RAIN_EXPOSURE' : undefined,
    };
  },
};
export const eventPolicy: RoutingPolicyPlugin = {
  id: 'events',
  evaluate(e, c) {
    for (const event of c.events) {
      if (!eventIsActive(event, c.now)) continue;
      const match =
        (!!event.target.facilityId && event.target.facilityId === e.facilityId) ||
        event.target.edgeIds?.includes(e.id);
      if (!match) continue;
      if (event.type === 'facility_closed' || event.type === 'construction')
        return { blocked: true, reasonCode: 'FACILITY_CLOSED' };
      if (event.type === 'crowding') return { penalty: 50, reasonCode: 'CROWDING' };
    }
    return {};
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
