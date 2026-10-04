import type {
  Scene,
  RoutingContext,
  RouteResult,
  RouteSegment,
  MobilityEdge,
  MobilityGraph,
} from '../domain/schema';
import type { Preferences } from '../genai/contracts';
import type { WorkflowContext, WorkflowResponse } from '../genai/workflows';

export type KnowledgeRecord = {
  id: string;
  scene_id: string;
  names: string[];
  category: string;
  level_id?: string;
  lon: number;
  lat: number;
  node_id: string | null;
  association: 'approximate' | 'unmapped';
  association_distance_m: number | null;
  source: string;
  verified_url?: string;
  media_ids: string[];
};
export type DemoMedia = {
  id: string;
  scene_id: string;
  title: string;
  path: string;
  kind: 'historical_photo' | 'map_view' | 'scripted_sign';
  source_url: string;
  author: string;
  license: string;
  license_url: string;
  captured_at: string;
  description: string;
  camera_node_id: string | null;
};
export type DemoState = {
  policy_mode: 'distance_only' | 'accessible';
  scene_id: string;
  current_node_id: string;
  destination_node_id: string;
  routing: RoutingContext;
  preferences: Preferences | null;
  guidance: string;
};
export type DemoRouteSnapshot = {
  result: RouteResult;
  segments: RouteSegment[];
  exposed_m: number;
  facilities: string[];
};
export type DemoStep = {
  agent_records: {
    agent: string;
    source: 'example_library' | 'computed';
    input: unknown;
    output: unknown;
  }[];
  id: string;
  title: string;
  utterance: string;
  explanation: string;
  context: WorkflowContext;
  response: WorkflowResponse | null;
  state: DemoState;
  route: DemoRouteSnapshot;
  media_ids: string[];
  knowledge_ids: string[];
  route_changed: boolean;
};
export type DemoCase = {
  id: string;
  title: string;
  person: string;
  purpose: string;
  origin_scene_id: string;
  destination_scene_id: string;
  tags: string[];
  narrative: string;
  initial_state: DemoState;
  destination_route: DemoRouteSnapshot;
  steps: DemoStep[];
};
export type DemoLibrary = {
  version: '1.0';
  generated_at: string;
  cases: DemoCase[];
  media: DemoMedia[];
  knowledge: KnowledgeRecord[];
};
export type DemoScenes = Map<string, Scene>;
export type DemoOverlay = {
  scene_id: string;
  edges: MobilityEdge[];
  facilities: MobilityGraph['facilities'];
  assumptions: string[];
};
