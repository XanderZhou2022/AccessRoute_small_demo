import { randomUUID } from 'node:crypto';
import type { AgentResult } from '../../shared/genai/contracts';
import { IntegrationError, validateResult } from '../../shared/genai/contracts';
import type { WorkflowContext, PhotoInput, WorkflowResponse } from '../../shared/genai/workflows';
import type { ModelProvider } from '../providers/model';
import type { SpeechProvider } from '../providers/speech';
import type { SceneRepository } from '../repositories/scenes';
import type { EventRepository } from '../repositories/events';
import { buildMapIndex } from '../retrieval/map-index';
import { prepareMapContext } from './context';
import { preferencesWorkflow } from './preferences';
import { obstacleWorkflow } from './obstacle';
import { localizationWorkflow } from './localization';
import { guidanceWorkflow } from './guidance';
import type { PendingMatch, WorkflowRun } from './types';
export class WorkflowService {
  private readonly pending = new Map<string, PendingMatch & { expires: number }>();
  constructor(
    private readonly deps: {
      model: ModelProvider;
      speech: SpeechProvider;
      scenes: SceneRepository;
      events: EventRepository;
    },
  ) {}
  async run(
    workflow: AgentResult['agent'],
    input: WorkflowContext,
    content?: string | PhotoInput,
  ): Promise<WorkflowResponse> {
    const scene = await this.deps.scenes.load(input.scene_id, input.routing.graphMode);
    const map = prepareMapContext(scene, input, await this.deps.events.list());
    const deps = {
      ...this.deps,
      scene,
      map,
      index: buildMapIndex(scene, await this.deps.scenes.landmarks(scene)),
    };
    let run: WorkflowRun;
    switch (workflow) {
      case 'preferences':
        run = await preferencesWorkflow(deps, content as string);
        break;
      case 'obstacle':
        run = await obstacleWorkflow(deps, content as PhotoInput);
        break;
      case 'localization':
        run = await localizationWorkflow(deps, content as PhotoInput);
        break;
      case 'guidance':
        run = await guidanceWorkflow(deps);
        break;
    }
    if (run.response.result) validateResult(run.response.result, scene);
    if (run.pending) {
      for (const [key, value] of this.pending)
        if (value.expires < Date.now()) this.pending.delete(key);
      const confirmation_id = randomUUID();
      this.pending.set(confirmation_id, { ...run.pending, expires: Date.now() + 5 * 60 * 1000 });
      run.response.confirmation_id = confirmation_id;
    }
    return run.response;
  }
  async confirm(
    id: string,
    candidateId: string,
    context: WorkflowContext,
  ): Promise<WorkflowResponse> {
    const pending = this.pending.get(id);
    if (!pending || pending.expires < Date.now())
      throw new IntegrationError('CONFIRMATION_EXPIRED', '候選已過期，請重新拍照');
    if (pending.context_id !== context.context_id)
      throw new IntegrationError('STALE_CONTEXT', '路線已改變，請重新識別');
    const candidate = pending.response.candidates.find((c) => c.id === candidateId);
    if (!candidate) throw new IntegrationError('INVALID_REFERENCE', '候選不在本次匹配結果中');
    const result = pending.build(candidate, candidate.score, true);
    const scene = await this.deps.scenes.load(context.scene_id, context.routing.graphMode);
    prepareMapContext(scene, context, await this.deps.events.list());
    validateResult(result, scene);
    this.pending.delete(id);
    return {
      ...pending.response,
      status: 'ready',
      result,
      confirmation_id: undefined,
      trace: [
        ...pending.response.trace,
        { step: 'user-confirmation', summary: `用戶確認：${candidate.names.join(' / ')}` },
      ],
      message: '已確認候選，可以套用至導航。',
    };
  }
}
