import { z } from 'zod';
import { preferenceSchema, type AgentResult } from './contracts';
import { contextSchema, type RouteSegment } from '../domain/schema';
const id = z.string().min(1).max(200);
export const workflowContextSchema = z.object({
  context_id: id,
  scene_id: z.string().regex(/^[a-z0-9-]+$/),
  current_node_id: id,
  destination_node_id: id,
  phase: z.enum(['planning', 'navigation', 'transit', 'complete']),
  routing: contextSchema,
  preferences: preferenceSchema.nullable(),
  segment_id: id.nullable(),
});
export type WorkflowContext = z.infer<typeof workflowContextSchema>;
export const positionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative(),
});
export const photoInputSchema = z.object({
  image: z
    .string()
    .max(12_000_000)
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/),
  position: positionSchema.optional(),
  level_id: id.optional(),
});
export type PhotoInput = z.infer<typeof photoInputSchema>;
export const preferenceRequestSchema = z.object({
  context: workflowContextSchema,
  text: z.string().trim().min(1).max(4000),
});
export const photoRequestSchema = z.object({
  context: workflowContextSchema,
  ...photoInputSchema.shape,
});
export const guidanceRequestSchema = z.object({ context: workflowContextSchema });
export const landmarkSchema = z.object({
  id,
  scene_id: id,
  node_id: id,
  level_id: id.optional(),
  names: z.array(z.string().min(1)).min(1),
  category: z.string(),
  descriptions: z.array(z.string()),
  source: z.string().min(1),
  association: z.enum(['verified', 'approximate', 'demo']).optional(),
});
export type LandmarkRecord = z.infer<typeof landmarkSchema>;
export type MapCandidate = {
  id: string;
  names: string[];
  category: string;
  descriptions: string[];
  source: string;
  node_id: string;
  level_id?: string;
  facility_id?: string;
  edge_ids?: string[];
  lon: number;
  lat: number;
  distance_m: number;
  route_distance_m: number;
  association?: 'verified' | 'approximate' | 'demo';
};
export type RankedCandidate = MapCandidate & {
  score: number;
  evidence: string[];
};
export type WorkflowTrace = { step: string; summary: string };
export type SpeechPlan = {
  mode: 'browser';
  language: 'zh-HK';
  selection: 'cantonese_female' | 'cantonese_male' | 'text_only';
};
export type WorkflowResponse = {
  workflow: AgentResult['agent'];
  status: 'ready' | 'needs_confirmation' | 'no_match';
  result: AgentResult | null;
  candidates: RankedCandidate[];
  trace: WorkflowTrace[];
  message: string;
  speech?: SpeechPlan;
  confirmation_id?: string;
};
export type MapContext = {
  input: WorkflowContext;
  segments: RouteSegment[];
  segment: RouteSegment | null;
};
