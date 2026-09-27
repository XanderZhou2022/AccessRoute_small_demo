import { z } from 'zod';
const id = z.string().min(1);
export const nodeSchema = z.object({
  id,
  sceneId: id,
  venueId: id.optional(),
  levelId: id.optional(),
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  z: z.number().finite().optional(),
  kind: z.enum(['entrance', 'junction', 'lift', 'stairs', 'stop', 'poi']),
  facilityId: id.optional(),
  label: z.string().optional(),
  sourceRef: z.string().optional(),
});
export const edgeSchema = z.object({
  id,
  from: id,
  to: id,
  distanceM: z.number().finite().nonnegative(),
  kind: z.enum(['corridor', 'outdoor', 'bridge', 'ramp', 'lift', 'stairs', 'escalator']),
  bidirectional: z.boolean().default(true),
  indoor: z.boolean().optional(),
  sheltered: z.boolean().optional(),
  wheelchair: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  slope: z.number().finite().optional(),
  surface: z.string().optional(),
  facilityId: id.optional(),
  geometry: z
    .array(z.tuple([z.number(), z.number()]))
    .min(2)
    .optional(),
  provenance: z.enum(['official', 'derived', 'manual/demo augmentation']),
  sourceRef: z.string().optional(),
  tags: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export const graphSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    sceneId: id,
    nodes: z.array(nodeSchema).min(1),
    edges: z.array(edgeSchema),
    facilities: z
      .array(
        z.object({
          id,
          label: z.string(),
          kind: z.enum(['lift', 'stairs', 'ramp']),
          sourceRefs: z.array(z.string()).default([]),
        }),
      )
      .default([]),
  })
  .superRefine((g, ctx) => {
    const nodes = new Map(g.nodes.map((n) => [n.id, n]));
    const facilities = new Set(g.facilities.map((f) => f.id));
    if (nodes.size !== g.nodes.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate node ID' });
    if (new Set(g.edges.map((e) => e.id)).size !== g.edges.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate edge ID' });
    if (facilities.size !== g.facilities.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate facility ID' });
    for (const n of g.nodes) {
      if (n.sceneId !== g.sceneId)
        ctx.addIssue({ code: 'custom', message: `Node ${n.id} scene mismatch` });
      if (n.facilityId && !facilities.has(n.facilityId))
        ctx.addIssue({ code: 'custom', message: `Unknown node facility ${n.facilityId}` });
    }
    for (const e of g.edges) {
      const a = nodes.get(e.from),
        b = nodes.get(e.to);
      if (!a || !b) ctx.addIssue({ code: 'custom', message: `Dangling edge ${e.id}` });
      if (e.facilityId && !facilities.has(e.facilityId))
        ctx.addIssue({ code: 'custom', message: `Unknown facility ${e.facilityId}` });
      if (
        a &&
        b &&
        a.levelId &&
        b.levelId &&
        a.levelId !== b.levelId &&
        !['lift', 'stairs', 'ramp', 'escalator'].includes(e.kind)
      )
        ctx.addIssue({ code: 'custom', message: `Non-vertical cross-level edge ${e.id}` });
      if (
        ['lift', 'stairs', 'escalator'].includes(e.kind) &&
        (!e.facilityId || !a?.levelId || !b?.levelId)
      )
        ctx.addIssue({ code: 'custom', message: `Missing vertical metadata ${e.id}` });
    }
  });
const safeFile = z.string().regex(/^[a-zA-Z0-9_-]+\.(json|geojson)$/);
export const manifestSchema = z.object({
  schemaVersion: z.literal('1.0'),
  sceneId: z.string().regex(/^[a-z0-9-]+$/),
  venueId: id,
  name: z.string(),
  nameZh: z.string(),
  district: z.string(),
  station: z.string(),
  stationZh: z.string(),
  entryPoints: z.array(id),
  defaultStart: id,
  defaultEnd: id,
  center: z.tuple([z.number(), z.number()]),
  levels: z.array(z.object({ id, label: z.string(), z: z.number() })),
  capabilities: z.object({
    indoor: z.boolean(),
    z: z.boolean(),
    wheelchairMetadata: z.boolean(),
    shelterMetadata: z.boolean(),
  }),
  files: z.record(safeFile),
  dataQuality: z.string(),
});
export const eventSchema = z
  .object({
    id,
    type: z.enum(['facility_closed', 'construction', 'crowding', 'custom']),
    target: z
      .object({ facilityId: id.optional(), edgeIds: z.array(id).optional() })
      .refine(
        (t) => !!t.facilityId || !!t.edgeIds?.length,
        'An event must target a facility or edges',
      ),
    status: z.enum(['active', 'resolved']),
    validFrom: z.string().datetime({ offset: true }),
    validUntil: z.string().datetime({ offset: true }).optional(),
    confidence: z.number().min(0).max(1).optional(),
    source: z.enum(['official', 'crowd', 'demo']),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine(
    (e) => !e.validUntil || Date.parse(e.validUntil) > Date.parse(e.validFrom),
    'validUntil must follow validFrom',
  );
export const contextSchema = z.object({
  profile: z.enum(['wheelchair', 'elderly', 'stroller']),
  rain: z.boolean().default(false),
  strictAccessibility: z.boolean().default(false),
  now: z.string().datetime({ offset: true }),
  events: z.array(eventSchema).default([]),
});
export type MobilityNode = z.infer<typeof nodeSchema>;
export type MobilityEdge = z.infer<typeof edgeSchema>;
export type MobilityGraph = z.infer<typeof graphSchema>;
export type SceneManifest = z.infer<typeof manifestSchema>;
export type DynamicEvent = z.infer<typeof eventSchema>;
export type RoutingContext = z.infer<typeof contextSchema>;
export type Profile = RoutingContext['profile'];
export type Feature = {
  type: 'Feature';
  geometry: { type: string; coordinates: any };
  properties: Record<string, any>;
  id?: string;
};
export type FeatureCollection = { type: 'FeatureCollection'; features: Feature[] };
export type Scene = {
  manifest: SceneManifest;
  graph: MobilityGraph;
  levels: FeatureCollection;
  units: FeatureCollection;
  openings: FeatureCollection;
  amenities: FeatureCollection;
  surroundings: FeatureCollection;
  metadata: Record<string, unknown>;
};
export type RouteResult =
  | {
      status: 'ok';
      nodeIds: string[];
      edgeIds: string[];
      distanceM: number;
      cost: number;
      reasonCodes: string[];
      warnings: string[];
    }
  | { status: 'no_route'; reasonCodes: string[]; warnings: string[] };
export type RouteSegment = {
  id: string;
  sceneId: string;
  type: 'floor' | 'transition' | 'outdoor' | 'bridge';
  venueId?: string;
  levelId?: string;
  nodeIds: string[];
  edgeIds: string[];
  geometry: [number, number][];
  distanceM: number;
  facilityId?: string;
  mode?: 'lift' | 'stairs' | 'ramp' | 'escalator';
  fromLevel?: string;
  toLevel?: string;
};
export type NavigationLeg = {
  type: 'navigation';
  id: string;
  sceneId: string;
  from: string;
  to: string;
  route: RouteResult;
  segments: RouteSegment[];
};
export type TransitLeg = {
  type: 'transit';
  id: string;
  from: string;
  to: string;
  abstract: true;
  label: string;
};
export type Leg = NavigationLeg | TransitLeg;
export type Journey = { id: string; legs: Leg[] };
export function validateScene(s: Scene): Scene {
  const manifest = manifestSchema.parse(s.manifest),
    graph = graphSchema.parse(s.graph);
  if (graph.sceneId !== manifest.sceneId) throw new Error('Manifest / graph scene mismatch');
  const nodes = new Set(graph.nodes.map((n) => n.id)),
    levels = new Set(manifest.levels.map((l) => l.id));
  for (const id of [...manifest.entryPoints, manifest.defaultStart, manifest.defaultEnd])
    if (!nodes.has(id)) throw new Error(`Unknown entry point ${id}`);
  for (const n of graph.nodes)
    if (n.levelId && !levels.has(n.levelId)) throw new Error(`Unknown level ${n.levelId}`);
  for (const layer of ['levels', 'units', 'openings', 'amenities', 'surroundings'] as const)
    if (s[layer]?.type !== 'FeatureCollection' || !Array.isArray(s[layer].features))
      throw new Error(`Invalid ${layer} GeoJSON`);
  return { ...s, manifest, graph };
}
