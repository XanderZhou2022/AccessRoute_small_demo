import type { AgentResult } from '../genai/contracts';
import type { WorkflowContext, WorkflowResponse, PhotoInput } from '../genai/workflows';
import type { DemoCase } from './types';

export interface WorkflowClient {
  run(
    workflow: AgentResult['agent'],
    context: WorkflowContext,
    input?: { text?: string } | Partial<PhotoInput>,
  ): Promise<WorkflowResponse>;
}

/** An explicit recorded stage is required; arbitrary prompts are never presented as live inference. */
export class ExampleWorkflowClient implements WorkflowClient {
  constructor(
    private readonly example: DemoCase,
    private readonly stepId: string,
  ) {}
  async run(workflow: AgentResult['agent'], context: WorkflowContext): Promise<WorkflowResponse> {
    const step = this.example.steps.find((s) => s.id === this.stepId)!;
    if (!step.response || step.response.workflow !== workflow)
      throw new Error('此階段沒有這個 workflow 的例子');
    if (
      context.scene_id !== step.context.scene_id ||
      context.current_node_id !== step.context.current_node_id ||
      context.destination_node_id !== step.context.destination_node_id
    )
      throw new Error('例子與目前地圖上下文不一致');
    const response = structuredClone(step.response);
    if (response.result) response.result.context_id = context.context_id;
    return response;
  }
}
