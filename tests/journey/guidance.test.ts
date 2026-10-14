import { describe, expect, it } from 'vitest';
import type { MobilityGraph, RouteSegment } from '../../shared/domain/schema';
import { guidanceChunks } from '../../shared/journey/guidance';

const graph: MobilityGraph = {
  schemaVersion: '1.0',
  sceneId: 'pace-fixture',
  nodes: ['a', 'b', 'c', 'd'].map((id, index) => ({
    id,
    sceneId: 'pace-fixture',
    venueId: 'venue',
    levelId: 'ground',
    lon: 114 + index * 0.00001,
    lat: 22,
    kind: 'junction',
  })),
  facilities: [],
  edges: [
    {
      id: 'ab',
      from: 'a',
      to: 'b',
      distanceM: 30,
      kind: 'corridor',
      bidirectional: true,
      wheelchair: 'verified_accessible',
      provenance: 'official',
    },
    {
      id: 'bc',
      from: 'b',
      to: 'c',
      distanceM: 30,
      kind: 'corridor',
      bidirectional: true,
      wheelchair: 'verified_accessible',
      provenance: 'official',
    },
    {
      id: 'cd',
      from: 'c',
      to: 'd',
      distanceM: 30,
      kind: 'corridor',
      bidirectional: true,
      wheelchair: 'verified_accessible',
      provenance: 'official',
    },
  ],
};

const corridor: RouteSegment = {
  id: 'segment-0',
  sceneId: graph.sceneId,
  type: 'floor',
  venueId: 'venue',
  levelId: 'ground',
  nodeIds: ['a', 'b', 'c', 'd'],
  edgeIds: ['ab', 'bc', 'cd'],
  geometry: [],
  distanceM: 90,
};

describe('pace-aware navigation guidance', () => {
  it('splits walking instructions into shorter chunks at a slower pace', () => {
    const slow = guidanceChunks(graph, corridor, 0.5);
    const brisk = guidanceChunks(graph, corridor, 1);

    expect(slow).toHaveLength(2);
    expect(brisk).toHaveLength(1);
    expect(slow.flatMap((chunk) => chunk.edgeIds)).toEqual(corridor.edgeIds);
    expect(slow[0].nodeIds[0]).toBe('a');
    expect(slow.at(-1)?.nodeIds.at(-1)).toBe('d');
    expect(slow.reduce((sum, chunk) => sum + chunk.distanceM, 0)).toBe(90);
  });

  it('keeps individual floor transitions intact at every walking pace', () => {
    const transition = { ...corridor, type: 'transition' as const };
    expect(guidanceChunks(graph, transition, 0.5)).toHaveLength(1);
    expect(guidanceChunks(graph, transition, 1)).toHaveLength(1);
  });
});
