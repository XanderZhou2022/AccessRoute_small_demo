import type { AgentResult } from '../../../shared/genai/contracts';
import type {
  WorkflowContext,
  WorkflowResponse,
  PhotoInput,
} from '../../../shared/genai/workflows';
import type { DynamicEvent } from '../../../shared/domain/schema';
import type { WorkflowClient } from '../../../shared/demo/provider';
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data as T;
}
export function runWorkflow(
  workflow: AgentResult['agent'],
  context: WorkflowContext,
  input: { text?: string } | Partial<PhotoInput> = {},
) {
  return post<WorkflowResponse>(`/api/genai/workflows/${workflow}`, { context, ...input });
}
export function confirmCandidate(
  confirmation_id: string,
  candidate_id: string,
  context: WorkflowContext,
) {
  return post<WorkflowResponse>('/api/genai/confirm', { confirmation_id, candidate_id, context });
}
export async function capabilities(): Promise<{ configured: boolean }> {
  const response = await fetch('/api/genai/capabilities');
  if (!response.ok) throw new Error('目前未連接 Agent 後端，請啟動本機服務');
  return response.json();
}
export const saveEvent = (event: DynamicEvent) => post<DynamicEvent>('/api/events', event);

export const apiWorkflowClient: WorkflowClient = { run: runWorkflow };
