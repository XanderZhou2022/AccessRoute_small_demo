import type { Scene, RouteSegment } from '../../../shared/domain/schema';

const floorColors = [
  '#087f8c',
  '#7c3aed',
  '#be185d',
  '#2563eb',
  '#4d7c0f',
  '#a21caf',
  '#0369a1',
  '#9333ea',
  '#0e7490',
  '#047857',
  '#b91c1c',
  '#4338ca',
];
export const transitionColor = '#c2410c';
export function levelLabel(scene: Scene, id?: string) {
  const label = scene.manifest.levels.find((l) => l.id === id)?.label || '室外';
  const compact: Record<string, string> = {
    又一城地下: 'G/F',
    又一城高層地下: 'UG',
    又一城低層地下一樓: 'LG1',
    又一城低層地下二樓: 'LG2',
    又一城地鐵層: 'MTR 層',
  };
  return compact[label] || label;
}
export function segmentColor(scene: Scene, segment: RouteSegment) {
  if (segment.type === 'transition') return transitionColor;
  if (segment.type === 'bridge') return '#2563eb';
  if (segment.type === 'outdoor') return '#475569';
  const levels = [...scene.manifest.levels].sort(
    (a, b) => (a.z ?? 0) - (b.z ?? 0) || a.id.localeCompare(b.id),
  );
  return floorColors[
    Math.max(
      0,
      levels.findIndex((l) => l.id === segment.levelId),
    ) % floorColors.length
  ];
}
export function transitionText(scene: Scene, segment: RouteSegment) {
  const from = scene.manifest.levels.find((l) => l.id === segment.fromLevel);
  const to = scene.manifest.levels.find((l) => l.id === segment.toLevel);
  const direction =
    from && to && to.z !== undefined && from.z !== undefined
      ? to.z > from.z
        ? '上樓'
        : to.z < from.z
          ? '下樓'
          : '換層'
      : '換層';
  const mode = { lift: '電梯', stairs: '樓梯', ramp: '坡道', escalator: '扶手電梯' }[
    segment.mode || 'lift'
  ];
  return `${mode}${direction} · ${levelLabel(scene, segment.fromLevel)} → ${levelLabel(scene, segment.toLevel)}`;
}
export function segmentLabel(scene: Scene, segment: RouteSegment) {
  if (segment.type === 'transition') return transitionText(scene, segment);
  if (segment.type === 'bridge') return '天橋';
  if (segment.type === 'outdoor') return '室外接駁';
  return `${levelLabel(scene, segment.levelId)} 室內`;
}
export function endpoints(scene: Scene, segments: RouteSegment[]) {
  if (!segments.length) return [];
  const first = scene.graph.nodes.find((n) => n.id === segments[0].nodeIds[0]);
  const last = scene.graph.nodes.find((n) => n.id === segments[segments.length - 1].nodeIds.at(-1));
  return [
    { node: first, role: '起點', color: '#047857' },
    { node: last, role: '終點', color: '#be185d' },
  ].flatMap(({ node, role, color }) =>
    node
      ? [
          {
            node,
            role,
            color,
            detail:
              node.kind === 'stop'
                ? scene.manifest.stationZh
                : `${scene.manifest.nameZh} · ${levelLabel(scene, node.levelId)}`,
          },
        ]
      : [],
  );
}
