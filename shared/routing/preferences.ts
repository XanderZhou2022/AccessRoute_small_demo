import type { RoutingContext } from '../domain/schema';
import type { Preferences } from '../genai/contracts';
/** One translation for the live workflow, browser and recorded example consumer. */
export function applyRoutingPreferences(context: RoutingContext, p: Preferences): RoutingContext {
  return {
    ...context,
    profile: p.mobility_type === 'manual_wheelchair' ? 'wheelchair' : p.mobility_type,
    avoidStairs: p.avoid_stairs,
    allowStairs: !p.avoid_stairs,
    allowEscalators: p.allow_escalators ?? !p.avoid_stairs,
    avoidSteepSlopes: p.avoid_steep_slopes,
    preferCoveredShelter: p.prefer_covered_shelter,
    ...(p.avoid_lifts !== undefined ? { avoidLifts: p.avoid_lifts } : {}),
    ...(p.route_objective !== undefined ? { objective: p.route_objective } : {}),
    ...(p.max_slope !== undefined ? { maxSlope: p.max_slope } : {}),
    ...(p.min_width_m !== undefined ? { minWidthM: p.min_width_m } : {}),
  };
}
