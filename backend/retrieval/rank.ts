import type { MapCandidate, RankedCandidate } from '../../shared/genai/workflows';
import type { Observation } from '../agents/vision';
import { normalize } from './map-index';
// Bigrams support partial OCR and Chinese names without a vector database.
function grams(text: string) {
  const value = normalize(text);
  return new Set(
    value.length < 2
      ? [value]
      : Array.from({ length: value.length - 1 }, (_, i) => value.slice(i, i + 2)),
  );
}
function similarity(a: string, b: string) {
  if (!normalize(a) || !normalize(b)) return 0;
  if (normalize(a) === normalize(b)) return 1;
  const x = grams(a),
    y = grams(b);
  const common = [...x].filter((g) => y.has(g)).length;
  return (2 * common) / (x.size + y.size);
}
const generic = new Set([
  'lift',
  'elevator',
  '升降機',
  '電梯',
  'corridor',
  '走廊',
  'stair',
  'stairs',
  '樓梯',
  'lobby',
  '大堂',
  'ramp',
  '斜道',
  '斜坡',
  'store',
  'shop',
  '商店',
  '店舖',
  '入口',
  'entry',
  'entrance',
  '防煙間',
  'smokelobby',
]);
export function lexicalScore(observation: Observation, candidate: MapCandidate) {
  const hints = [...observation.names, ...observation.text];
  return Math.max(
    0,
    ...[...hints, ...observation.objects].flatMap((hint) =>
      candidate.descriptions.map((description) => similarity(hint, description) * 0.85),
    ),
    ...hints.flatMap((hint) =>
      candidate.names.map(
        (name) => similarity(hint, name) * (generic.has(normalize(name)) ? 0.35 : 1),
      ),
    ),
  );
}
export function shortlist(observation: Observation, candidates: MapCandidate[]) {
  return [...candidates]
    .sort(
      (a, b) =>
        lexicalScore(observation, b) - lexicalScore(observation, a) || a.distance_m - b.distance_m,
    )
    .slice(0, 20);
}
export function rankCandidates(
  observation: Observation,
  candidates: MapCandidate[],
  matches: { candidate_id: string; evidence: { observed: string; mapped: string }[] }[],
): RankedCandidate[] {
  const visible = [...observation.names, ...observation.text, ...observation.objects].map(
    normalize,
  );
  return candidates
    .map((candidate) => {
      const mapped = [...candidate.names, candidate.category, ...candidate.descriptions].map(
        normalize,
      );
      const evidence = matches
        .filter((m) => m.candidate_id === candidate.id)
        .flatMap((m) => m.evidence)
        .filter(
          (pair) =>
            normalize(pair.observed).length >= 2 &&
            normalize(pair.mapped).length >= 2 &&
            visible.some((s) => s.includes(normalize(pair.observed))) &&
            mapped.some((s) => s.includes(normalize(pair.mapped))),
        );
      const lexical = lexicalScore(observation, candidate);
      const semantic = evidence.length ? 1 : 0;
      const spatial = Math.max(0, 1 - candidate.distance_m / 120);
      const route = Math.max(0, 1 - candidate.route_distance_m / 50);
      // Score is a retrieval score, not a calibrated probability. Geometry alone contributes <= .15.
      const score = Math.min(
        observation.confidence,
        candidate.association === 'approximate' ? 0.79 : 1,
        0.7 * lexical + 0.15 * semantic + 0.1 * spatial + 0.05 * route,
      );
      return {
        ...candidate,
        route_distance_m: Number.isFinite(candidate.route_distance_m)
          ? candidate.route_distance_m
          : 1_000_000,
        score: Math.round(score * 1000) / 1000,
        evidence: evidence.map((pair) => `${pair.observed} ↔ ${pair.mapped}`),
      };
    })
    .sort((a, b) => b.score - a.score || a.distance_m - b.distance_m);
}
export function decision(candidates: RankedCandidate[], target: 'localization' | 'obstacle') {
  const top = candidates[0];
  if (!top || top.score < 0.2) return 'no_match' as const;
  // Repeated official unit/amenity records on the same graph node refer to the same approximate position.
  const other = candidates.find((c) =>
    target === 'localization'
      ? c.node_id !== top.node_id
      : (c.facility_id || c.id) !== (top.facility_id || top.id),
  );
  return top.score >= 0.8 && top.score - (other?.score || 0) >= 0.12
    ? ('ready' as const)
    : ('needs_confirmation' as const);
}
