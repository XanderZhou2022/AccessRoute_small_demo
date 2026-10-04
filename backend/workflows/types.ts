import { randomUUID } from 'node:crypto';
import type { Scene } from '../../shared/domain/schema';
import type { MapContext, MapCandidate, WorkflowResponse } from '../../shared/genai/workflows';
import type { AgentResult } from '../../shared/genai/contracts';
import type { ModelProvider } from '../providers/model';
import type { SpeechProvider } from '../providers/speech';
export type WorkflowDependencies = {
  model: ModelProvider;
  speech: SpeechProvider;
  scene: Scene;
  map: MapContext;
  index: MapCandidate[];
};
export function envelope<T extends AgentResult['agent']>(
  map: MapContext,
  agent: T,
  payload: Extract<AgentResult, { agent: T }>['payload'],
): Extract<AgentResult, { agent: T }> {
  return {
    version: '1.0',
    request_id: randomUUID(),
    context_id: map.input.context_id,
    scene_id: map.input.scene_id,
    agent,
    payload,
  } as Extract<AgentResult, { agent: T }>;
}
export type PendingMatch = {
  response: WorkflowResponse;
  context_id: string;
  // Human confirmation consumes this stored observation; no second VLM call.
  build: (candidate: MapCandidate, score: number, confirmed: boolean) => AgentResult;
};
export type WorkflowRun = { response: WorkflowResponse; pending?: PendingMatch };
