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
    .max(8_000_023)
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)
    .refine((value) => {
      const payload = value.slice(value.indexOf(',') + 1);
      if (!payload || payload.length % 4 !== 0) return false;
      const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
      return Math.floor((payload.length * 3) / 4) - padding <= 6_000_000;
    }, 'Photo must not exceed 6 MB'),
  position: positionSchema.optional(),
  level_id: id.optional(),
  description: z.string().trim().min(1).max(1000).optional(),
});
export type PhotoInput = z.infer<typeof photoInputSchema>;
export const preferenceRequestSchema = z.object({
  context: workflowContextSchema,
  text: z.string().trim().min(1).max(4000),
});
export const locationResolutionRequestSchema = z
  .object({
    transcript: z.string().trim().min(1).max(1000),
    locations: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]+$/),
            name: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .min(2)
      .max(50),
    current_origin_id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    current_destination_id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
  })
  .superRefine((request, context) => {
    const currentOriginId = request.current_origin_id;
    const currentDestinationId = request.current_destination_id;
    const hasCurrentOrigin = Boolean(currentOriginId);
    const hasCurrentDestination = Boolean(currentDestinationId);
    if (hasCurrentOrigin !== hasCurrentDestination) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Current origin and destination must be supplied together',
      });
      return;
    }
    if (!hasCurrentOrigin) return;
    const ids = new Set(request.locations.map((location) => location.id));
    if (
      !currentOriginId ||
      !currentDestinationId ||
      !ids.has(currentOriginId) ||
      !ids.has(currentDestinationId) ||
      currentOriginId === currentDestinationId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Current trip must use two different supplied locations',
      });
    }
  });
export type LocationResolutionRequest = z.infer<typeof locationResolutionRequestSchema>;
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
  mode: 'browser' | 'azure' | 'canto_tts';
  language: 'zh-HK';
  selection: 'cantonese_female' | 'cantonese_male' | 'text_only';
  voice_selection?: 'single_default';
};
export const speechRequestSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  selection: z.enum(['cantonese_female', 'cantonese_male']).default('cantonese_female'),
});
export type SpeechRequest = z.infer<typeof speechRequestSchema>;
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
