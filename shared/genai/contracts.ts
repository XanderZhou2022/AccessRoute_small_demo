import { z } from 'zod';
import type { Scene, DynamicEvent } from '../domain/schema';
const id = z.string().min(1).max(200);
const base = { version: z.literal('1.0'), request_id: id, context_id: id, scene_id: id };
const gps = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    accuracy_m: z.number().nonnegative(),
  })
  .strict();
export const preferenceSchema = z
  .object({
    mobility_type: z.enum([
      'walking',
      'wheelchair',
      'manual_wheelchair',
      'elderly',
      'stroller',
      'heavy_luggage',
    ]),
    avoid_stairs: z.boolean(),
    allow_escalators: z.boolean().optional(),
    avoid_lifts: z.boolean().optional(),
    route_objective: z
      .enum(['balanced', 'shortest', 'sheltered', 'indoor', 'least_effort', 'fastest'])
      .optional(),
    max_slope: z.number().nonnegative().optional(),
    min_width_m: z.number().positive().optional(),
    avoid_steep_slopes: z.boolean(),
    prefer_covered_shelter: z.boolean(),
    tts_selection: z.enum(['cantonese_female', 'cantonese_male', 'text_only']),
  })
  .strict();
export const resultSchema = z.discriminatedUnion('agent', [
  z.object({ ...base, agent: z.literal('preferences'), payload: preferenceSchema }).strict(),
  z
    .object({
      ...base,
      agent: z.literal('obstacle'),
      payload: z
        .object({
          event_id: id,
          has_obstacle: z.boolean(),
          barrier_type: z.enum([
            'broken_lift',
            'facility_closed',
            'stairs_only',
            'puddle',
            'construction',
            'none',
          ]),
          location_sign: z.string().max(500),
          is_indoor: z.boolean(),
          gps: gps.optional(),
          target: z
            .object({
              facility_id: id.optional(),
              edge_ids: z.array(id).min(1).max(500).optional(),
            })
            .strict()
            .refine(
              (t) => Boolean(t.facility_id) !== Boolean(t.edge_ids),
              'Choose exactly one target: facility_id or edge_ids',
            ),
          confidence: z.number().min(0).max(1),
          match_method: z.enum(['map_evidence', 'user_confirmed']).optional(),
          valid_from: z.string().datetime({ offset: true }),
          valid_until: z.string().datetime({ offset: true }),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      agent: z.literal('localization'),
      payload: z
        .object({
          is_indoor: z.boolean(),
          status: z.enum(['matched', 'outdoor_use_gps_directly']),
          map_db_node_id: id.optional(),
          level_id: id.optional(),
          anchor_names: z.array(z.string().min(1).max(200)).max(20),
          direction_hint: z.string().max(500),
          confidence: z.number().min(0).max(1),
          match_method: z.enum(['map_evidence', 'user_confirmed']).optional(),
          gps: gps.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      agent: z.literal('guidance'),
      payload: z
        .object({
          segment_id: id,
          text: z.string().trim().min(1).max(60),
          audio_url: z
            .string()
            .url()
            .refine((s) => {
              const u = new URL(s);
              return (
                !u.username &&
                !u.password &&
                (u.protocol === 'https:' ||
                  (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))
              );
            }, 'Audio must use HTTPS (HTTP loopback allowed for local development)')
            .optional(),
        })
        .strict(),
    })
    .strict(),
]);
export type AgentResult = z.infer<typeof resultSchema>;
export type Preferences = z.infer<typeof preferenceSchema>;
export class IntegrationError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function validateResult(input: unknown, scene: Scene): AgentResult {
  const r = resultSchema.parse(input);
  const fail = (message: string): never => {
    throw new IntegrationError('INVALID_REFERENCE', message);
  };
  if (r.scene_id !== scene.manifest.sceneId) fail('scene_id does not match loaded scene');
  if (r.agent === 'obstacle') {
    const p = r.payload;
    if (Date.parse(p.valid_until) <= Date.parse(p.valid_from))
      fail('valid_until must follow valid_from');
    if (p.has_obstacle === (p.barrier_type === 'none'))
      fail('has_obstacle and barrier_type disagree');
    if (p.confidence < 0.8 && p.match_method !== 'user_confirmed')
      throw new IntegrationError('LOW_CONFIDENCE', 'Obstacle confidence must be at least 0.8');
    if (p.target.facility_id && !scene.graph.facilities.some((f) => f.id === p.target.facility_id))
      fail('Unknown facility_id');
    if (p.target.edge_ids?.some((id) => !scene.graph.edges.some((e) => e.id === id)))
      fail('Unknown edge_ids');
    if (
      p.barrier_type === 'broken_lift' &&
      !scene.graph.facilities.some((f) => f.id === p.target.facility_id && f.kind === 'lift')
    )
      fail('broken_lift requires a lift facility_id');
    if (p.barrier_type === 'facility_closed' && !p.target.facility_id)
      fail('facility_closed requires a facility_id');
  }
  if (r.agent === 'localization') {
    const p = r.payload;
    if (!p.is_indoor) {
      if (p.status === 'outdoor_use_gps_directly') {
        if (p.map_db_node_id || p.level_id) fail('GPS-only result must not contain a map match');
      } else {
        const node = scene.graph.nodes.find((n) => n.id === p.map_db_node_id);
        if (!node || node.levelId || p.level_id)
          fail('Outdoor map match requires a known outdoor node');
        if (p.confidence < 0.8 && p.match_method !== 'user_confirmed')
          throw new IntegrationError(
            'LOW_CONFIDENCE',
            'Localization confidence must be at least 0.8',
          );
      }
    } else {
      const node = scene.graph.nodes.find((n) => n.id === p.map_db_node_id);
      if (
        p.status !== 'matched' ||
        !p.level_id ||
        !node ||
        node.levelId !== p.level_id ||
        !p.anchor_names.length
      )
        fail('Indoor match requires known node, matching level_id and anchor_names');
      if (p.confidence < 0.8 && p.match_method !== 'user_confirmed')
        throw new IntegrationError(
          'LOW_CONFIDENCE',
          'Localization confidence must be at least 0.8',
        );
    }
  }
  return r;
}
export function obstacleEvent(r: Extract<AgentResult, { agent: 'obstacle' }>): DynamicEvent {
  const p = r.payload;
  return {
    id: 'genai-' + r.scene_id + '-' + p.event_id,
    type: p.target.facility_id ? 'facility_closed' : 'construction',
    target: { facilityId: p.target.facility_id, edgeIds: p.target.edge_ids },
    status: p.has_obstacle ? 'active' : 'resolved',
    validFrom: p.valid_from,
    validUntil: p.valid_until,
    confidence: p.confidence,
    source: 'demo',
    metadata: {
      agent: 'obstacle',
      request_id: r.request_id,
      barrier_type: p.barrier_type,
      location_sign: p.location_sign,
      match_method: p.match_method,
    },
  };
}
export type IntegrationContext = {
  version: '1.0';
  context_id: string;
  scene_id: string;
  phase: 'planning' | 'navigation' | 'transit' | 'complete';
  profile: string;
  preferences: Preferences | null;
  current_node_id: string;
  destination_node_id: string;
  segment: import('../domain/schema').RouteSegment | null;
  levels: Scene['manifest']['levels'];
  facilities: Scene['graph']['facilities'];
};
export function examples(c: IntegrationContext, scene: Scene): AgentResult[] {
  const envelope = { version: '1.0' as const, context_id: c.context_id, scene_id: c.scene_id };
  const node =
    scene.graph.nodes.find((n) => n.id === c.current_node_id && n.levelId) ||
    scene.graph.nodes.find((n) => n.levelId)!;
  return [
    {
      ...envelope,
      request_id: crypto.randomUUID(),
      agent: 'preferences',
      payload: {
        mobility_type: 'manual_wheelchair',
        avoid_stairs: true,
        avoid_steep_slopes: true,
        prefer_covered_shelter: true,
        tts_selection: 'cantonese_female',
      },
    },
    {
      ...envelope,
      request_id: crypto.randomUUID(),
      agent: 'obstacle',
      payload: {
        event_id: 'lift-example',
        has_obstacle: true,
        barrier_type: 'broken_lift',
        location_sign: 'Lift A（聯調示例）',
        is_indoor: true,
        target: { facility_id: scene.graph.facilities.find((f) => f.kind === 'lift')!.id },
        confidence: 0.95,
        valid_from: new Date().toISOString(),
        valid_until: new Date(Date.now() + 3600000).toISOString(),
      },
    },
    {
      ...envelope,
      request_id: crypto.randomUUID(),
      agent: 'localization',
      payload: {
        is_indoor: true,
        status: 'matched',
        map_db_node_id: node.id,
        level_id: node.levelId,
        anchor_names: ['聯調錨點（非模型識別）'],
        direction_hint: '目前路段起點',
        confidence: 0.95,
      },
    },
    {
      ...envelope,
      request_id: crypto.randomUUID(),
      agent: 'guidance',
      payload: {
        segment_id: c.segment?.id || 'segment-0',
        text: '請跟住畫面標示嘅路線慢慢行，到下一個位置再按「已到達」。',
      },
    },
  ];
}
